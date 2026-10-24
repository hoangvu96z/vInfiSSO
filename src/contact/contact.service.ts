import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, type SelectQueryBuilder } from 'typeorm';
import { ContactMessage, AttachedImage } from './contact-message.entity';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { parseUserAgent, lookupIpLocation } from './device-detector.util';
import * as crypto from 'node:crypto';
import { parseAdminDateRange } from '../common/admin-date-range.util';
import * as path from 'node:path';
import type { ObjectStorage } from '../storage/object-storage';
import { LocalObjectStorage } from '../storage/local-object-storage';
import { LOCAL_UPLOAD_STORAGE } from '../storage/local-upload-storage.module';

export const ADMIN_MESSAGE_LIST_COLUMNS = [
  'message.id',
  'message.sessionId',
  'message.app',
  'message.name',
  'message.email',
  'message.title',
  'message.message',
  'message.imageMime',
  'message.isRead',
  'message.senderIp',
  'message.device',
  'message.browser',
  'message.os',
  'message.location',
  'message.isp',
  'message.metadata',
  'message.createdAt',
  'message.updatedAt',
] as const;

export const SESSION_MESSAGE_LIST_COLUMNS = [
  'message.id',
  'message.sessionId',
  'message.name',
  'message.email',
  'message.title',
  'message.message',
  'message.createdAt',
] as const;

export const MESSAGE_IMAGE_COUNT_SQL = `CASE
  WHEN jsonb_typeof(message.images) = 'array' AND jsonb_array_length(message.images) > 0
    THEN jsonb_array_length(message.images)
  WHEN message.image_data IS NOT NULL AND message.image_data <> ''
    THEN 1
  ELSE 0
END`;

export const MESSAGE_PRIMARY_IMAGE_MIME_SQL = `COALESCE(
  message.image_mime,
  CASE
    WHEN jsonb_typeof(message.images) = 'array' AND jsonb_array_length(message.images) > 0
      THEN message.images->0->>'mime'
    ELSE NULL
  END
)`;

export type ContactMessageSummary = Omit<
  ContactMessage,
  'images' | 'imageData'
> & {
  hasImage: boolean;
  imageCount: number;
  images?: undefined;
  imageData?: undefined;
};

export function summarizeContactMessageImages(
  message: {
    hasImage?: boolean;
    imageCount?: number;
    images?: AttachedImage[] | null;
    imageData?: string | null;
  },
  rawRow?: Record<string, unknown>,
): { hasImage: boolean; imageCount: number } {
  const rawImageCount = rawRow?.message_image_count;
  const parsedRawCount =
    rawImageCount !== undefined && rawImageCount !== null
      ? Number(rawImageCount)
      : Number.NaN;

  const computedCount = Number.isFinite(parsedRawCount)
    ? Math.max(0, Math.trunc(parsedRawCount))
    : typeof message.imageCount === 'number' &&
        Number.isFinite(message.imageCount)
      ? Math.max(0, Math.trunc(message.imageCount))
      : Array.isArray(message.images) && message.images.length > 0
        ? message.images.length
        : typeof message.imageData === 'string' && message.imageData.length > 0
          ? 1
          : message.hasImage
            ? 1
            : 0;

  const hasImage =
    !Number.isFinite(parsedRawCount) && typeof message.hasImage === 'boolean'
      ? message.hasImage || computedCount > 0
      : computedCount > 0;
  const imageCount = hasImage ? Math.max(1, computedCount) : 0;

  return { hasImage, imageCount };
}

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    @InjectRepository(ContactMessage)
    private readonly messageRepo: Repository<ContactMessage>,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    @Inject(LOCAL_UPLOAD_STORAGE)
    private readonly uploadStorage: ObjectStorage = new LocalObjectStorage(
      path.join(process.cwd(), 'uploads'),
    ),
  ) {}

  createGuestSessionToken(sessionId: string): string {
    const expiresAt = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;
    const signature = crypto
      .createHmac('sha256', this.getGuestSessionSecret())
      .update(`${sessionId}:${expiresAt}`)
      .digest('base64url');
    return `${expiresAt}.${signature}`;
  }

  isValidGuestSessionToken(
    sessionId: string,
    candidate: string | undefined,
  ): boolean {
    const match = candidate?.match(/^(\d{10,13})\.([A-Za-z0-9_-]{43})$/);
    if (!match) return false;
    const expiresAt = Number(match[1]);
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= now ||
      expiresAt > now + 90 * 24 * 60 * 60
    )
      return false;
    const expected = Buffer.from(
      crypto
        .createHmac('sha256', this.getGuestSessionSecret())
        .update(`${sessionId}:${expiresAt}`)
        .digest('base64url'),
    );
    const actual = Buffer.from(match[2]);
    return (
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual)
    );
  }

  async hasMessagesBySession(sessionId: string): Promise<boolean> {
    return (await this.messageRepo.count({ where: { sessionId } })) > 0;
  }

  private getGuestSessionSecret(): string {
    const secret =
      this.configService.get<string>('CONTACT_SESSION_SECRET') ||
      this.configService.get<string>('SESSION_SECRET') ||
      this.configService.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32)
      throw new Error(
        'A 32-character contact session signing secret is required',
      );
    return secret;
  }

  /**
   * Create a new contact message and send email notification to admin.
   */
  async createMessage(dto: {
    sessionId: string;
    name: string;
    email?: string;
    title?: string;
    message: string;
    imageData?: string;
    imageMime?: string;
    images?: AttachedImage[];
    senderIp?: string | null;
    userAgent?: string | null;
    clientMeta?: Record<string, unknown> | null;
  }): Promise<ContactMessage> {
    const { device, browser, os } = parseUserAgent(
      dto.userAgent || '',
      dto.clientMeta || undefined,
    );
    const geo = await lookupIpLocation(dto.senderIp);

    const metadata = {
      ...(dto.clientMeta || {}),
      userAgent: dto.userAgent || null,
      os,
    };

    // New uploads are stored under the backed-up uploads tree. Legacy DB fields
    // remain readable, but new messages never put image bytes into PostgreSQL.
    const incomingImages =
      dto.images && Array.isArray(dto.images) && dto.images.length > 0
        ? dto.images.slice(0, 3)
        : dto.imageData
          ? [{ data: dto.imageData, mime: dto.imageMime || 'image/jpeg' }]
          : [];
    const images = incomingImages.length
      ? await this.persistImages(incomingImages)
      : null;
    const primaryImageMime = images?.[0]?.mime || null;

    const msg = this.messageRepo.create({
      sessionId: dto.sessionId,
      name: dto.name,
      email: dto.email || null,
      title: dto.title || null,
      message: dto.message,
      images,
      imageData: null,
      imageMime: primaryImageMime,
      senderIp: dto.senderIp || null,
      device: device || null,
      browser: browser || null,
      os: os || null,
      location: geo?.location || null,
      isp: geo?.isp || null,
      metadata,
    });

    let saved: ContactMessage;
    try {
      saved = await this.messageRepo.save(msg);
    } catch (error) {
      await this.deleteUploadKeysBestEffort(
        (images || []).flatMap((image) =>
          image.objectKey ? [image.objectKey] : [],
        ),
      );
      throw error;
    }
    this.logger.log(
      `New contact message from ${dto.name} (${device}, ${geo?.location || 'IP: ' + dto.senderIp}) with ${images?.length || 0} image(s)`,
    );

    // Send email notification (fire-and-forget)
    this.sendNotificationEmail(saved).catch((err: unknown) => {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown notification error';
      this.logger.error(`Failed to send notification email: ${errorMessage}`);
    });

    return saved;
  }

  /**
   * Get all messages (admin only) without hydrating base64 image payloads.
   */
  async getAllMessages(
    page = 1,
    limit = 50,
    filters: {
      search?: string;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ): Promise<{ messages: ContactMessageSummary[]; total: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const { start, end } = parseAdminDateRange(
      filters.dateFrom,
      filters.dateTo,
    );

    const query = this.messageRepo
      .createQueryBuilder('message')
      .select([...ADMIN_MESSAGE_LIST_COLUMNS])
      .addSelect(MESSAGE_IMAGE_COUNT_SQL, 'message_image_count')
      .addSelect(MESSAGE_PRIMARY_IMAGE_MIME_SQL, 'message_primary_image_mime')
      .orderBy('message.createdAt', 'DESC')
      .addOrderBy('message.id', 'ASC');

    if (filters.status === 'read' || filters.status === 'unread') {
      query.andWhere('message.isRead = :isRead', {
        isRead: filters.status === 'read',
      });
    }

    if (filters.search?.trim()) {
      const search = `%${filters.search.trim().toLowerCase()}%`;
      query.andWhere(
        '(LOWER(message.name) LIKE :search OR LOWER(message.email) LIKE :search OR LOWER(message.title) LIKE :search OR LOWER(message.message) LIKE :search OR LOWER(message.device) LIKE :search OR LOWER(message.location) LIKE :search)',
        { search },
      );
    }

    if (start)
      query.andWhere('message.createdAt >= :dateFrom', { dateFrom: start });
    if (end) query.andWhere('message.createdAt < :dateTo', { dateTo: end });

    query.skip((safePage - 1) * safeLimit).take(safeLimit);

    const { entities, raw, total } =
      await this.executePaginatedSummaryQuery(query);
    return {
      messages: entities.map((message, index) =>
        this.toMessageSummary(message, raw[index]),
      ),
      total,
    };
  }

  /**
   * Alias for admin list retrieval.
   */
  async getAdminMessages(
    page = 1,
    limit = 50,
    filters: {
      search?: string;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ): Promise<{ messages: ContactMessageSummary[]; total: number }> {
    return this.getAllMessages(page, limit, filters);
  }

  /**
   * Get messages by session ID (for returning visitors) without hydrating image payloads.
   */
  async getMessagesBySession(
    sessionId: string,
  ): Promise<ContactMessageSummary[]> {
    if (typeof this.messageRepo.createQueryBuilder === 'function') {
      const query = this.messageRepo
        .createQueryBuilder('message')
        .select([...SESSION_MESSAGE_LIST_COLUMNS])
        .addSelect(MESSAGE_IMAGE_COUNT_SQL, 'message_image_count')
        .where('message.sessionId = :sessionId', { sessionId })
        .orderBy('message.createdAt', 'ASC')
        .addOrderBy('message.id', 'ASC');

      const { entities, raw } = await this.executeSummaryQuery(query);
      return entities.map((message, index) =>
        this.toMessageSummary(message, raw[index]),
      );
    }

    const messages = await this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
    return messages.map((message) => this.toMessageSummary(message));
  }

  private async executePaginatedSummaryQuery(
    query: SelectQueryBuilder<ContactMessage>,
  ): Promise<{
    entities: ContactMessage[];
    raw: Array<Record<string, unknown>>;
    total: number;
  }> {
    if (
      typeof query.getRawAndEntities === 'function' &&
      typeof query.getCount === 'function'
    ) {
      const { entities, raw } = await query.getRawAndEntities();
      const total = await query.getCount();
      return {
        entities,
        raw: Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [],
        total,
      };
    }

    const [entities, total] = await query.getManyAndCount();
    return { entities, raw: [], total };
  }

  private async executeSummaryQuery(
    query: SelectQueryBuilder<ContactMessage>,
  ): Promise<{
    entities: ContactMessage[];
    raw: Array<Record<string, unknown>>;
  }> {
    if (typeof query.getRawAndEntities === 'function') {
      const { entities, raw } = await query.getRawAndEntities();
      return {
        entities,
        raw: Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [],
      };
    }

    const entities = await query.getMany();
    return { entities, raw: [] };
  }

  private toMessageSummary(
    message: ContactMessage & { hasImage?: boolean; imageCount?: number },
    rawRow?: Record<string, unknown>,
  ): ContactMessageSummary {
    const { hasImage, imageCount } = summarizeContactMessageImages(
      message,
      rawRow,
    );
    const fallbackMime =
      typeof rawRow?.message_primary_image_mime === 'string'
        ? rawRow.message_primary_image_mime
        : (message.images?.[0]?.mime ?? null);
    const { imageData: _imageData, images: _images, ...rest } = message;
    void _imageData;
    void _images;

    return {
      ...rest,
      ...(rest.imageMime !== undefined || fallbackMime !== null
        ? { imageMime: rest.imageMime ?? fallbackMime }
        : {}),
      hasImage,
      imageCount,
    };
  }

  /**
   * Get single message by ID.
   */
  async getMessageById(id: string): Promise<ContactMessage | null> {
    const message = await this.messageRepo.findOne({ where: { id } });
    if (!message?.images?.length) return message;

    // This method is called only by the existing @AdminOnly detail route.
    // Hydrate private files for that response while omitting internal keys.
    const images = await Promise.all(
      message.images.map(async (image) => {
        const { objectKey, data, ...metadata } = image;
        if (data !== undefined) return { ...metadata, data };
        if (!objectKey) return { ...metadata, data: '' };
        const bytes = await this.uploadStorage.get(objectKey);
        return { ...metadata, data: bytes?.toString('base64') ?? '' };
      }),
    );
    return { ...message, images };
  }

  /**
   * Mark a message as read.
   */
  async markAsRead(id: string): Promise<void> {
    await this.messageRepo.update(id, { isRead: true });
  }

  /**
   * Mark multiple messages as read.
   */
  async markMessagesAsRead(ids: string[]): Promise<void> {
    if (!ids || ids.length === 0) return;
    await this.messageRepo.update({ id: In(ids) }, { isRead: true });
  }

  /**
   * Mark all messages as read.
   */
  async markAllAsRead(): Promise<void> {
    await this.messageRepo.update({}, { isRead: true });
  }

  /**
   * Delete a message.
   */
  async deleteMessage(id: string): Promise<void> {
    await this.messageRepo.delete(id);
    // Keep the file so a backup whose DB dump preceded this delete can restore it.
  }

  /**
   * Delete multiple messages.
   */
  async deleteMessages(ids: string[]): Promise<void> {
    if (!ids || ids.length === 0) return;
    await this.messageRepo.delete({ id: In(ids) });
    // Keep the files for the same DB/filesystem backup consistency reason.
  }

  /**
   * Get unread count.
   */
  async getUnreadCount(): Promise<number> {
    return this.messageRepo.count({ where: { isRead: false } });
  }

  /**
   * Send email notification to admin about a new message.
   */
  private async sendNotificationEmail(msg: ContactMessage): Promise<void> {
    const adminEmail = this.configService.get<string>(
      'CONTACT_NOTIFY_EMAIL',
      'hoangvu96z@gmail.com',
    );
    const fromAddress =
      this.configService.get<string>('SMTP_FROM') ||
      this.configService.get<string>(
        'MAIL_FROM',
        '"TalkWithMe" <noreply@vunph.click>',
      );

    const ssoBase = this.configService.get<string>(
      'SSO_BASE_URL',
      'https://sso.vunph.click',
    );
    const dashLink = `${ssoBase}/ui/admin#contact`;

    const attachments: any[] = [];
    let imageSection = '';

    const imageSources =
      msg.images && msg.images.length > 0
        ? msg.images
        : msg.imageData
          ? [{ data: msg.imageData, mime: msg.imageMime || 'image/jpeg' }]
          : [];

    const imagesToAttach: Array<AttachedImage & { data: string }> = [];
    for (const image of imageSources) {
      let data = image.data;
      if (data === undefined && image.objectKey) {
        const bytes = await this.uploadStorage.get(image.objectKey);
        if (!bytes) throw new Error('Contact attachment file is missing');
        data = bytes.toString('base64');
      }
      if (data !== undefined) imagesToAttach.push({ ...image, data });
    }

    if (imagesToAttach.length > 0) {
      const imgTags = imagesToAttach
        .map((img, idx) => {
          const ext = (img.mime?.split('/')[1] || 'png').replace('jpeg', 'jpg');
          const cid = `attached_image_${idx}`;
          attachments.push({
            filename: `image_${msg.sessionId?.substring(0, 8) || 'attach'}_${idx + 1}.${ext}`,
            content: Buffer.from(img.data, 'base64'),
            contentType: img.mime || 'image/jpeg',
            cid,
          });
          return `<div style="display: inline-block; margin: 6px; text-align: center;">
          <img src="cid:${cid}" alt="Ảnh ${idx + 1}" style="max-width: 100%; max-height: 380px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);" />
          ${img.width && img.height ? `<div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">720p (${img.width}x${img.height})</div>` : ''}
        </div>`;
        })
        .join('');

      imageSection = `
        <div style="margin-top: 24px; padding: 16px; background: rgba(6, 182, 212, 0.06); border: 1px solid rgba(6, 182, 212, 0.25); border-radius: 12px;">
          <p style="margin: 0 0 12px; font-weight: 600; color: #06b6d4; font-size: 14px;">📷 Hình ảnh đính kèm (${imagesToAttach.length}/3 ảnh · 720p):</p>
          <div style="text-align: center;">
            ${imgTags}
          </div>
        </div>
      `;
    }

    const formattedTime = new Date(msg.createdAt).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      dateStyle: 'full',
      timeStyle: 'medium',
    });

    const subjectPreview =
      msg.title ||
      (msg.message.length > 50
        ? msg.message.substring(0, 50) + '…'
        : msg.message);

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #e2e8f0; margin: 0; padding: 32px 16px; }
        .container { max-width: 600px; margin: 0 auto; background: #131b2e; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 32px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
        .logo { font-size: 22px; font-weight: 700; color: #06b6d4; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; }
        .badge { display: inline-block; background: rgba(6,182,212,0.15); color: #38bdf8; border: 1px solid rgba(6,182,212,0.3); padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 12px; }
        h2 { color: #ffffff; font-size: 20px; margin: 0 0 20px; line-height: 1.4; }
        .info-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; overflow: hidden; }
        .info-table td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .info-table tr:last-child td { border-bottom: none; }
        .label { color: #94a3b8; font-weight: 500; width: 130px; }
        .value { color: #f1f5f9; font-weight: 600; }
        .msg-heading { font-size: 14px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin: 20px 0 8px; }
        .message-box { background: rgba(15, 23, 42, 0.85); border-left: 4px solid #06b6d4; padding: 18px 20px; border-radius: 0 12px 12px 0; margin: 8px 0 24px; border-top: 1px solid rgba(255,255,255,0.06); border-right: 1px solid rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.06); }
        .message-box p { color: #e2e8f0; line-height: 1.7; font-size: 15px; white-space: pre-wrap; margin: 0; word-break: break-word; }
        .btn-container { text-align: center; margin: 28px 0 16px; }
        .btn { display: inline-block; padding: 13px 32px; background: linear-gradient(135deg, #0891b2, #06b6d4); color: #ffffff !important; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 14px rgba(6,182,212,0.35); }
        .footer { text-align: center; font-size: 12px; color: #64748b; margin-top: 24px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 18px; line-height: 1.5; }
        .code { font-family: monospace; background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; font-size: 13px; color: #cbd5e1; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">💬 TalkWithMe · Tin Nhắn Mới</div>
        <div class="badge">Khách Liên Hệ</div>
        <h2>${msg.title ? `"${msg.title}"` : 'Tin nhắn mới từ khách'}</h2>

        <table class="info-table">
          <tr>
            <td class="label">👤 Người gửi:</td>
            <td class="value">${msg.name}</td>
          </tr>
          <tr>
            <td class="label">✉️ Email:</td>
            <td class="value">
              ${msg.email ? `<a href="mailto:${msg.email}" style="color: #38bdf8; text-decoration: none;">${msg.email}</a> <span style="font-size: 12px; color: #94a3b8; font-weight: normal;">(Bấm Reply để trả lời)</span>` : '<span style="color: #64748b; font-weight: normal; font-style: italic;">Khách không để lại email</span>'}
            </td>
          </tr>
          <tr>
            <td class="label">📌 Tiêu đề:</td>
            <td class="value">${msg.title || '<span style="color: #64748b; font-weight: normal; font-style: italic;">(Không có tiêu đề)</span>'}</td>
          </tr>
          <tr>
            <td class="label">🕒 Thời gian:</td>
            <td class="value">${formattedTime}</td>
          </tr>
          <tr>
            <td class="label">📱 Thiết bị:</td>
            <td class="value">${msg.device || '<span style="color: #64748b; font-weight: normal;">Không xác định</span>'}</td>
          </tr>
          <tr>
            <td class="label">🌐 Trình duyệt:</td>
            <td class="value">${msg.browser || '<span style="color: #64748b; font-weight: normal;">Không xác định</span>'}</td>
          </tr>
          <tr>
            <td class="label">📍 Vị trí (IP):</td>
            <td class="value">
              <strong style="color: #38bdf8;">${msg.location || 'Không xác định'}</strong>
              ${msg.isp ? `<span style="font-size: 12px; color: #94a3b8; font-weight: normal; margin-left: 6px;">(Mạng: ${msg.isp})</span>` : ''}
            </td>
          </tr>
          ${
            msg.metadata?.timezone || msg.metadata?.language
              ? `
          <tr>
            <td class="label">⏰ Múi giờ / Lang:</td>
            <td class="value"><span class="code">${msg.metadata?.timezone || 'N/A'}</span> · <span class="code">${msg.metadata?.language || 'N/A'}</span></td>
          </tr>`
              : ''
          }
          <tr>
            <td class="label">🌐 Địa chỉ IP:</td>
            <td class="value"><span class="code">${msg.senderIp || 'N/A'}</span></td>
          </tr>
          <tr>
            <td class="label">🔑 Session ID:</td>
            <td class="value"><span class="code">${msg.sessionId}</span></td>
          </tr>
        </table>

        <div class="msg-heading">Nội dung tin nhắn:</div>
        <div class="message-box">
          <p>${msg.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
        </div>

        ${imageSection}

        <div class="btn-container">
          <a href="${dashLink}" class="btn" target="_blank">Xem trên Dashboard SSO</a>
        </div>

        <div class="footer">
          <p>Tin nhắn được gửi qua TalkWithMe · Người nhận thông báo: <strong>hoangvu96z@gmail.com</strong></p>
          <p>© 2026 vInfi · sso.vunph.click</p>
        </div>
      </div>
    </body>
    </html>
    `;

    await this.mailService.sendMail({
      from: fromAddress,
      to: adminEmail,
      replyTo: msg.email || undefined,
      subject: `💬 [TalkWithMe] ${msg.name}: ${subjectPreview}`,
      html: htmlContent,
      attachments,
    });

    this.logger.log(
      `Notification email sent to ${adminEmail} (replyTo: ${msg.email || 'none'})`,
    );
  }

  private async persistImages(
    images: AttachedImage[],
  ): Promise<AttachedImage[]> {
    const extensionByMime: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
    };
    const storedKeys: string[] = [];

    try {
      const stored: AttachedImage[] = [];
      for (const image of images) {
        const extension = extensionByMime[image.mime];
        if (!extension || typeof image.data !== 'string') {
          throw new BadRequestException('Invalid contact image');
        }
        const data = image.data.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
        const bytes = Buffer.from(data, 'base64');
        if (!bytes.length)
          throw new BadRequestException('Invalid contact image');

        const objectKey = `contact/${crypto.randomUUID()}.${extension}`;
        storedKeys.push(objectKey);
        await this.uploadStorage.put(objectKey, bytes, image.mime);
        stored.push({
          mime: image.mime,
          objectKey,
          ...(image.name !== undefined ? { name: image.name } : {}),
          ...(image.size !== undefined ? { size: image.size } : {}),
          ...(image.width !== undefined ? { width: image.width } : {}),
          ...(image.height !== undefined ? { height: image.height } : {}),
        });
      }
      return stored;
    } catch (error) {
      await this.deleteUploadKeysBestEffort(storedKeys);
      throw error;
    }
  }

  private async deleteUploadKeysBestEffort(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.uploadStorage.delete(key);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(
          `Could not clean up a contact image upload: ${detail}`,
        );
      }
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ContactMessage, AttachedImage } from './contact-message.entity';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { parseUserAgent, lookupIpLocation } from './device-detector.util';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    @InjectRepository(ContactMessage)
    private readonly messageRepo: Repository<ContactMessage>,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

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
    clientMeta?: Record<string, any> | null;
  }): Promise<ContactMessage> {
    const { device, browser, os } = parseUserAgent(dto.userAgent || '', dto.clientMeta || undefined);
    const geo = await lookupIpLocation(dto.senderIp);

    const metadata = {
      ...(dto.clientMeta || {}),
      userAgent: dto.userAgent || null,
      os,
    };

    // Normalize images (up to 3 images max) and strip data URI prefixes
    let images: AttachedImage[] | null = null;
    let primaryImageData: string | null = null;
    let primaryImageMime: string | null = null;

    if (dto.images && Array.isArray(dto.images) && dto.images.length > 0) {
      images = dto.images.slice(0, 3).map((img) => ({
        ...img,
        data: (img.data || '').replace(/^data:image\/[a-zA-Z+]+;base64,/, ''),
      }));
      primaryImageData = images[0]?.data || null;
      primaryImageMime = images[0]?.mime || null;
    } else if (dto.imageData) {
      primaryImageData = dto.imageData.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
      primaryImageMime = dto.imageMime || 'image/jpeg';
      images = [{ data: primaryImageData, mime: primaryImageMime }];
    }

    const msg = this.messageRepo.create({
      sessionId: dto.sessionId,
      name: dto.name,
      email: dto.email || null,
      title: dto.title || null,
      message: dto.message,
      images,
      imageData: primaryImageData,
      imageMime: primaryImageMime,
      senderIp: dto.senderIp || null,
      device: device || null,
      browser: browser || null,
      os: os || null,
      location: geo?.location || null,
      isp: geo?.isp || null,
      metadata,
    });

    const saved = await this.messageRepo.save(msg);
    this.logger.log(`New contact message from ${dto.name} (${device}, ${geo?.location || 'IP: ' + dto.senderIp}) with ${images ? images.length : 0} image(s)`);

    // Send email notification (fire-and-forget)
    this.sendNotificationEmail(saved).catch((err) => {
      this.logger.error(`Failed to send notification email: ${err.message}`);
    });

    return saved;
  }

  /**
   * Get all messages (admin only).
   */
  async getAllMessages(page = 1, limit = 50): Promise<{ messages: ContactMessage[]; total: number }> {
    const [messages, total] = await this.messageRepo.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });
    return { messages, total };
  }

  /**
   * Get messages by session ID (for returning visitors).
   */
  async getMessagesBySession(sessionId: string): Promise<ContactMessage[]> {
    return this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Get single message by ID.
   */
  async getMessageById(id: string): Promise<ContactMessage | null> {
    return this.messageRepo.findOne({ where: { id } });
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
  }

  /**
   * Delete multiple messages.
   */
  async deleteMessages(ids: string[]): Promise<void> {
    if (!ids || ids.length === 0) return;
    await this.messageRepo.delete({ id: In(ids) });
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
    const adminEmail = this.configService.get<string>('CONTACT_NOTIFY_EMAIL', 'hoangvu96z@gmail.com');
    const fromAddress =
      this.configService.get<string>('SMTP_FROM') ||
      this.configService.get<string>('MAIL_FROM', '"TalkWithMe" <noreply@vunph.click>');

    const ssoBase = this.configService.get<string>('SSO_BASE_URL', 'https://sso.vunph.click');
    const dashLink = `${ssoBase}/ui/admin#contact`;

    const attachments: any[] = [];
    let imageSection = '';

    const imagesToAttach = msg.images && msg.images.length > 0
      ? msg.images
      : (msg.imageData ? [{ data: msg.imageData, mime: msg.imageMime || 'image/jpeg' }] : []);

    if (imagesToAttach.length > 0) {
      const imgTags = imagesToAttach.map((img, idx) => {
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
      }).join('');

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

    const subjectPreview = msg.title || (msg.message.length > 50 ? msg.message.substring(0, 50) + '…' : msg.message);

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
          ${msg.metadata?.timezone || msg.metadata?.language ? `
          <tr>
            <td class="label">⏰ Múi giờ / Lang:</td>
            <td class="value"><span class="code">${msg.metadata?.timezone || 'N/A'}</span> · <span class="code">${msg.metadata?.language || 'N/A'}</span></td>
          </tr>` : ''}
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

    this.logger.log(`Notification email sent to ${adminEmail} (replyTo: ${msg.email || 'none'})`);
  }
}

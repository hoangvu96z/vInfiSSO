import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContactMessage } from './contact-message.entity';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';

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
    senderIp?: string | null;
  }): Promise<ContactMessage> {
    const msg = this.messageRepo.create({
      sessionId: dto.sessionId,
      name: dto.name,
      email: dto.email || null,
      title: dto.title || null,
      message: dto.message,
      imageData: dto.imageData || null,
      imageMime: dto.imageMime || null,
      senderIp: dto.senderIp || null,
    });

    const saved = await this.messageRepo.save(msg);
    this.logger.log(`New contact message from ${dto.name} (session: ${dto.sessionId})`);

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
   * Get unread count.
   */
  async getUnreadCount(): Promise<number> {
    return this.messageRepo.count({ where: { isRead: false } });
  }

  /**
   * Send email notification to admin about a new message.
   */
  private async sendNotificationEmail(msg: ContactMessage): Promise<void> {
    const adminEmail = this.configService.get<string>('CONTACT_NOTIFY_EMAIL',
      this.configService.get<string>('SMTP_USER', 'admin@vunph.id.vn'));
    const fromAddress = this.configService.get<string>('SMTP_FROM', '"TalkWithMe" <admin@vunph.id.vn>');

    const ssoBase = this.configService.get<string>('SSO_BASE_URL', 'https://sso.vunph.click');
    const dashLink = `${ssoBase}/ui/admin#contact`;

    const imageSection = msg.imageData
      ? `<p style="margin-top:16px;"><strong>📷 Có hình ảnh đính kèm</strong> — xem trên dashboard.</p>`
      : '';

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #0f0f14; color: #e8e8f0; margin: 0; padding: 40px 20px; }
        .container { max-width: 560px; margin: 0 auto; background: #1a1a24; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 36px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
        .logo { text-align: center; margin-bottom: 24px; font-size: 24px; font-weight: bold; color: #06b6d4; }
        h2 { color: #fff; font-size: 18px; margin-bottom: 16px; }
        .info { background: rgba(6,182,212,0.08); border: 1px solid rgba(6,182,212,0.2); border-radius: 10px; padding: 16px; margin-bottom: 20px; }
        .info p { margin: 6px 0; color: #a0a0b0; font-size: 14px; line-height: 1.5; }
        .info strong { color: #e8e8f0; }
        .message-box { background: rgba(255,255,255,0.04); border-left: 3px solid #06b6d4; padding: 16px; border-radius: 0 8px 8px 0; margin: 20px 0; }
        .message-box p { color: #d0d0e0; line-height: 1.7; font-size: 15px; white-space: pre-wrap; margin: 0; }
        .btn-container { text-align: center; margin: 28px 0 12px; }
        .btn { display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #0891b2, #06b6d4); color: #fff !important; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px; }
        .footer { text-align: center; font-size: 12px; color: #666677; margin-top: 24px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">💬 TalkWithMe — Tin nhắn mới</div>
        <h2>${msg.title ? `"${msg.title}"` : 'Tin nhắn mới từ khách'}</h2>
        <div class="info">
          <p><strong>Người gửi:</strong> ${msg.name}</p>
          ${msg.email ? `<p><strong>Email:</strong> ${msg.email}</p>` : ''}
          <p><strong>Thời gian:</strong> ${new Date(msg.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</p>
          <p><strong>Session:</strong> ${msg.sessionId.substring(0, 8)}…</p>
        </div>
        <div class="message-box">
          <p>${msg.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
        </div>
        ${imageSection}
        <div class="btn-container">
          <a href="${dashLink}" class="btn" target="_blank">Xem trên Dashboard</a>
        </div>
        <div class="footer">
          <p>© 2026 vInfi · TalkWithMe</p>
        </div>
      </div>
    </body>
    </html>
    `;

    await this.mailService.sendMail({
      from: fromAddress,
      to: adminEmail,
      subject: `💬 [TalkWithMe] ${msg.name}: ${msg.title || 'Tin nhắn mới'}`,
      html: htmlContent,
    });

    this.logger.log(`Notification email sent to ${adminEmail}`);
  }
}

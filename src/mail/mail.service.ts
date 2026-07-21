import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST', 'localhost');
    const rawPort = this.configService.get<string | number>('SMTP_PORT', 465);
    const port = typeof rawPort === 'string' ? parseInt(rawPort, 10) : rawPort;
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    if (user && pass) {
      const isSecure = port === 465;
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: isSecure,
        auth: { user, pass },
        tls: {
          rejectUnauthorized: false,
        },
      });
      this.logger.log(`Configured external SMTP: ${host}:${port} (secure: ${isSecure})`);
    } else {
      this.transporter = nodemailer.createTransport({
        host,
        port: 25,
        ignoreTLS: true,
      });
      this.logger.log(`Configured local Mail Server on VPS (${host}:25)`);
    }
  }

  async sendVerificationEmail(email: string, displayNameOrToken: string, token?: string): Promise<void> {
    let displayName = displayNameOrToken;
    let verifyToken = token;
    if (!token) {
      verifyToken = displayNameOrToken;
      displayName = email;
    }

    const ssoBaseUrl = this.configService.get<string>('SSO_BASE_URL', 'https://sso.vunph.click');
    const verifyLink = `${ssoBaseUrl}/sso/verify-email?token=${verifyToken}`;
    const fromAddress = this.configService.get<string>('SMTP_FROM', '"vInfi SSO" <admin@vunph.id.vn>');

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f0f14; color: #e8e8f0; margin: 0; padding: 40px 20px; }
        .container { max-width: 520px; margin: 0 auto; background: #1a1a24; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 36px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
        .logo { text-align: center; margin-bottom: 24px; font-size: 28px; font-weight: bold; color: #a78bfa; }
        h2 { color: #ffffff; font-size: 20px; margin-bottom: 16px; }
        p { color: #a0a0b0; line-height: 1.6; font-size: 15px; margin-bottom: 24px; }
        .btn-container { text-align: center; margin: 32px 0; }
        .btn { display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #7c5cfc, #a78bfa); color: #ffffff !important; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 16px; box-shadow: 0 8px 20px rgba(124,92,252,0.3); }
        .expire-notice { font-size: 13px; color: #888899; text-align: center; margin-top: 24px; }
        .footer { text-align: center; font-size: 12px; color: #666677; margin-top: 32px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">✦ vInfi SSO</div>
        <h2>Xin chào ${displayName || email},</h2>
        <p>Cảm ơn bạn đã đăng ký tài khoản tại <strong>vInfi SSO</strong>. Vui lòng bấm vào nút bên dưới để xác nhận địa chỉ email của bạn:</p>
        <div class="btn-container">
          <a href="${verifyLink}" class="btn" target="_blank">Xác nhận Email</a>
        </div>
        <p class="expire-notice">⚠️ Thư xác nhận này có hiệu lực trong vòng <strong>24 giờ</strong>. Nếu bạn không thực hiện đăng ký, xin vui lòng bỏ qua email này.</p>
        <div class="footer">
          <p>© 2026 vInfi SSO. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
    `;

    try {
      await this.transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: '✦ [vInfi SSO] Xác nhận địa chỉ email tài khoản của bạn',
        html: htmlContent,
      });
      this.logger.log(`Verification email sent successfully to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${email}: ${error.message}`);
      this.logger.log(`[VERIFICATION LINK] ${email}: ${verifyLink}`);
    }
  }

  async sendPasswordResetEmail(email: string, token: string, displayName?: string): Promise<void> {
    const ssoBaseUrl = this.configService.get<string>('SSO_BASE_URL', 'https://sso.vunph.click');
    const resetLink = `${ssoBaseUrl}/ui/sso?reset_token=${token}`;
    const fromAddress = this.configService.get<string>('SMTP_FROM', '"vInfi SSO" <admin@vunph.id.vn>');

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0f0f14; color: #e8e8f0; margin: 0; padding: 40px 20px; }
        .container { max-width: 520px; margin: 0 auto; background: #1a1a24; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 36px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
        .logo { text-align: center; margin-bottom: 24px; font-size: 28px; font-weight: bold; color: #a78bfa; }
        h2 { color: #ffffff; font-size: 20px; margin-bottom: 16px; }
        p { color: #a0a0b0; line-height: 1.6; font-size: 15px; margin-bottom: 24px; }
        .btn-container { text-align: center; margin: 32px 0; }
        .btn { display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #7c5cfc, #a78bfa); color: #ffffff !important; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 16px; box-shadow: 0 8px 20px rgba(124,92,252,0.3); }
        .expire-notice { font-size: 13px; color: #888899; text-align: center; margin-top: 24px; }
        .footer { text-align: center; font-size: 12px; color: #666677; margin-top: 32px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">✦ vInfi SSO</div>
        <h2>Xin chào ${displayName || email},</h2>
        <p>Bạn đã yêu cầu đặt lại mật khẩu cho tài khoản tại <strong>vInfi SSO</strong>. Vui lòng bấm vào nút bên dưới để tiến hành đặt mật khẩu mới:</p>
        <div class="btn-container">
          <a href="${resetLink}" class="btn" target="_blank">Đặt lại mật khẩu</a>
        </div>
        <p class="expire-notice">⚠️ Thư này có hiệu lực trong vòng <strong>1 giờ</strong>. Nếu bạn không thực hiện yêu cầu này, xin vui lòng bỏ qua email.</p>
        <div class="footer">
          <p>© 2026 vInfi SSO. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
    `;

    try {
      await this.transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: '✦ [vInfi SSO] Yêu cầu đặt lại mật khẩu',
        html: htmlContent,
      });
      this.logger.log(`Password reset email sent successfully to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${email}: ${error.message}`);
    }
  }
}

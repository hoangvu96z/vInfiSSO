import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    const mailHost = this.configService.get<string>('MAIL_HOST');
    const mailPort = this.configService.get<number>('MAIL_PORT', 587);
    const mailUser = this.configService.get<string>('MAIL_USER');
    const mailPassword = this.configService.get<string>('MAIL_PASSWORD');
    const mailFrom = this.configService.get<string>(
      'MAIL_FROM',
      `noreply@${mailHost}`,
    );

    // For local Postfix (no auth needed)
    const auth =
      mailUser && mailPassword
        ? {
            user: mailUser,
            pass: mailPassword,
          }
        : undefined;

    this.transporter = nodemailer.createTransport({
      host: mailHost,
      port: mailPort,
      secure: mailPort === 465, // true for 465, false for other ports
      auth,
    });
  }

  async sendVerificationEmail(email: string, verificationToken: string) {
    const ssoBaseUrl = this.configService.get<string>('SSO_BASE_URL');
    const verificationUrl = `${ssoBaseUrl}/sso/verify-email?token=${verificationToken}`;

    const mailFrom = this.configService.get<string>(
      'MAIL_FROM',
      'noreply@vinfisso.com',
    );

    return this.transporter.sendMail({
      from: mailFrom,
      to: email,
      subject: '🔐 Xác nhận email của bạn - vInfi SSO',
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #7c5cfc;">Xác nhận Email</h2>
            <p>Cảm ơn bạn đã đăng ký tài khoản tại <strong>vInfi SSO</strong>!</p>
            <p>Để hoàn tất quá trình đăng ký, vui lòng xác nhận email của bạn bằng cách nhấp vào nút bên dưới:</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" style="
                display: inline-block;
                padding: 12px 30px;
                background-color: #7c5cfc;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                font-weight: bold;
              ">
                ✓ Xác nhận Email
              </a>
            </div>

            <p style="color: #888; font-size: 0.9em;">
              Hoặc copy link này vào trình duyệt:<br>
              <code style="word-break: break-all;">${verificationUrl}</code>
            </p>

            <p style="color: #888; font-size: 0.9em; margin-top: 30px;">
              Đường link này sẽ hết hạn trong 24 giờ.
            </p>

            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #999; font-size: 0.85em; text-align: center;">
              © 2026 vInfi SSO. All rights reserved.
            </p>
          </div>
        </div>
      `,
      text: `Xác nhận email của bạn tại: ${verificationUrl}`,
    });
  }

  async sendPasswordResetEmail(
    email: string,
    resetToken: string,
    displayName?: string | null,
  ) {
    const ssoBaseUrl = this.configService.get<string>('SSO_BASE_URL');
    const resetUrl = `${ssoBaseUrl}/sso/reset-password?token=${resetToken}`;

    const mailFrom = this.configService.get<string>(
      'MAIL_FROM',
      'noreply@vinfisso.com',
    );

    return this.transporter.sendMail({
      from: mailFrom,
      to: email,
      subject: '🔑 Đặt lại mật khẩu - vInfi SSO',
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #7c5cfc;">Đặt lại Mật khẩu</h2>
            <p>${displayName ? `Xin chào ${displayName},` : 'Xin chào,'}</p>
            <p>Chúng tôi đã nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.</p>
            <p>Nhấp vào nút bên dưới để tạo mật khẩu mới:</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="
                display: inline-block;
                padding: 12px 30px;
                background-color: #7c5cfc;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                font-weight: bold;
              ">
                🔑 Đặt lại Mật khẩu
              </a>
            </div>

            <p style="color: #888; font-size: 0.9em;">
              Hoặc copy link này vào trình duyệt:<br>
              <code style="word-break: break-all;">${resetUrl}</code>
            </p>

            <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
              <strong>⚠️ Lưu ý bảo mật:</strong><br>
              Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này. Tài khoản của bạn vẫn an toàn.
            </div>

            <p style="color: #888; font-size: 0.9em;">
              Đường link này sẽ hết hạn trong 1 giờ.
            </p>

            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #999; font-size: 0.85em; text-align: center;">
              © 2026 vInfi SSO. All rights reserved.
            </p>
          </div>
        </div>
      `,
      text: `Đặt lại mật khẩu của bạn tại: ${resetUrl}`,
    });
  }
}

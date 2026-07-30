import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { AuditLog } from '../users/audit-log.entity';

@Injectable()
export class SsoService {
  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  // ─── Register ─────────────────────────────────────────────────────────────
  // Sau đăng ký CHỈ gửi email, KHÔNG tạo session → user phải xác nhận email trước

  async register(
    dto: {
      email: string;
      password: string;
      displayName?: string;
    },
    reqMeta?: { ipAddress?: string; userAgent?: string; metadata?: any },
  ): Promise<{ message: string; email: string }> {
    if (!dto.email || !dto.password) {
      throw new BadRequestException('Email và mật khẩu là bắt buộc');
    }

    if (dto.password.length < 8) {
      throw new BadRequestException('Mật khẩu phải có ít nhất 8 ký tự');
    }

    const user = await this.usersService.createUser({
      email: dto.email,
      password: dto.password,
      displayName: dto.displayName,
    });

    await this.auditLogRepo.save({
      userId: user.id,
      action: 'register',
      app: 'sso',
      ipAddress: reqMeta?.ipAddress || null,
      userAgent: reqMeta?.userAgent || null,
      metadata: { email: user.email, ...reqMeta?.metadata },
    });

    return {
      message:
        'Đăng ký thành công! Vui lòng kiểm tra hộp thư email của bạn để xác nhận tài khoản trong vòng 24 giờ.',
      email: user.email,
    };
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  async login(
    dto: {
      email: string;
      password: string;
      appOrigin?: string;
    },
    reqMeta?: { ipAddress?: string; userAgent?: string; metadata?: any },
  ): Promise<{ token: string; user: Partial<User> }> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const valid = await this.usersService.verifyPassword(user, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    if (!user.isVerified) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'EMAIL_NOT_VERIFIED',
        message:
          'Tài khoản chưa được xác nhận email. Vui lòng kiểm tra hộp thư của bạn hoặc nhấn gửi lại email xác nhận.',
        requiresVerification: true,
        email: user.email,
      });
    }

    const token = await this.usersService.createSession(user.id, dto.appOrigin);

    await this.auditLogRepo.save({
      userId: user.id,
      action: 'login',
      app: 'sso',
      ipAddress: reqMeta?.ipAddress || null,
      userAgent: reqMeta?.userAgent || null,
      metadata: { appOrigin: dto.appOrigin || 'direct', ...reqMeta?.metadata },
    });

    return { token, user: this.sanitizeUser(user) };
  }

  // ─── OAuth Login (after passport validates) ───────────────────────────────

  async oauthLogin(
    user: User,
    appOrigin?: string,
    reqMeta?: { ipAddress?: string; userAgent?: string; metadata?: any },
  ): Promise<{ token: string; user: Partial<User> }> {
    if (!user.isVerified) {
      await this.usersService.markAsVerified(user.id);
      user.isVerified = true;
    }
    const token = await this.usersService.createSession(user.id, appOrigin);

    await this.auditLogRepo.save({
      userId: user.id,
      action: 'login_oauth',
      app: 'sso',
      ipAddress: reqMeta?.ipAddress || null,
      userAgent: reqMeta?.userAgent || null,
      metadata: { appOrigin: appOrigin || 'oauth', ...reqMeta?.metadata },
    });

    return { token, user: this.sanitizeUser(user) };
  }

  // ─── Resolve Session ──────────────────────────────────────────────────────

  async resolveSession(rawToken: string | undefined): Promise<User | null> {
    if (!rawToken) return null;
    return this.usersService.resolveSessionByToken(rawToken);
  }

  // ─── Logout ───────────────────────────────────────────────────────────────

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const user = await this.resolveSession(rawToken);
    if (user) {
      await this.auditLogRepo.save({
        userId: user.id,
        action: 'logout',
        app: 'sso',
      });
      // Xóa TẤT CẢ sessions của user để đảm bảo logout toàn bộ app (global SSO logout)
      await this.usersService.deleteAllSessionsForUser(user.id);
    } else {
      // Nếu không tìm thấy user, vẫn xóa session theo token này
      await this.usersService.deleteSessionByToken(rawToken);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  sanitizeUser(user: User): Partial<User> {
    const { passwordHash: _, emailVerificationToken: __, passwordResetToken: ___, ...safe } = user as any;
    return safe;
  }

  // ─── Email Verification ───────────────────────────────────────────────────

  async verifyEmail(token: string) {
    return this.usersService.verifyEmail(token);
  }

  async resendVerificationEmail(email: string) {
    return this.usersService.resendVerificationEmail(email);
  }

  // ─── Password Reset ───────────────────────────────────────────────────────

  async requestPasswordReset(email: string) {
    return this.usersService.requestPasswordReset(email);
  }

  async resetPassword(token: string, newPassword: string) {
    return this.usersService.resetPassword(token, newPassword);
  }

  async createSessionForUser(userId: string): Promise<string> {
    return this.usersService.createSession(userId);
  }

  // ─── Profile ───────────────────────────────────────────────────────────

  async updateProfile(
    userId: string,
    dto: { displayName?: string; avatarUrl?: string | null },
  ) {
    const user = await this.usersService.updateProfile(userId, dto);

    await this.auditLogRepo.save({
      userId: user.id,
      action: 'update_profile',
      app: 'sso',
      metadata: {
        updatedFields: Object.keys(dto).filter(
          (k) => (dto as Record<string, unknown>)[k] !== undefined,
        ),
      },
    });

    return this.sanitizeUser(user);
  }
}

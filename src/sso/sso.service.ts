import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';

@Injectable()
export class SsoService {
  constructor(private readonly usersService: UsersService) {}

  // ─── Register ─────────────────────────────────────────────────────────────

  async register(dto: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<{ token: string; user: Partial<User> }> {
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

    const token = await this.usersService.createSession(user.id, 'register');
    return { token, user: this.sanitizeUser(user) };
  }

  // ─── Login ────────────────────────────────────────────────────────────────

  async login(dto: {
    email: string;
    password: string;
    appOrigin?: string;
  }): Promise<{ token: string; user: Partial<User> }> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const valid = await this.usersService.verifyPassword(user, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const token = await this.usersService.createSession(user.id, dto.appOrigin);
    return { token, user: this.sanitizeUser(user) };
  }

  // ─── OAuth Login (after passport validates) ───────────────────────────────

  async oauthLogin(
    user: User,
    appOrigin?: string,
  ): Promise<{ token: string; user: Partial<User> }> {
    const token = await this.usersService.createSession(user.id, appOrigin);
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
    await this.usersService.deleteSessionByToken(rawToken);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  sanitizeUser(user: User): Partial<User> {
    const { passwordHash: _, ...safe } = user as any;
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
}

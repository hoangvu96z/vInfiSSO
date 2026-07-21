import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcryptjs from 'bcryptjs';
import { User } from './user.entity';
import { OAuthAccount } from './oauth-account.entity';
import { Session } from './session.entity';
import { MailService } from '../mail/mail.service';
import * as crypto from 'node:crypto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,

    @InjectRepository(OAuthAccount)
    private readonly oauthRepo: Repository<OAuthAccount>,

    @InjectRepository(Session)
    private readonly sessionsRepo: Repository<Session>,

    private readonly mailService: MailService,
  ) {}

  // ─── Users ────────────────────────────────────────────────────────────────

  async findByEmail(email: string): Promise<User | null> {
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    return this.usersRepo.findOne({ where: { email: normalized } });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { id } });
  }

  async createUser(dto: {
    email: string;
    password?: string;
    displayName?: string;
    avatarUrl?: string;
  }): Promise<User> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.findByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictException('Email đã được sử dụng');
    }

    const passwordHash = dto.password
      ? await bcryptjs.hash(dto.password, 12)
      : null;

    // Generate email verification token (expires in 24 hours)
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const emailVerificationTokenExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    );

    const user = this.usersRepo.create({
      email: normalizedEmail,
      passwordHash,
      displayName: dto.displayName?.trim() || normalizedEmail.split('@')[0],
      avatarUrl: dto.avatarUrl ?? null,
      emailVerificationToken,
      emailVerificationTokenExpiresAt,
    });

    const savedUser = await this.usersRepo.save(user);

    // Send verification email
    try {
      await this.mailService.sendVerificationEmail(
        normalizedEmail,
        emailVerificationToken,
      );
    } catch (error) {
      console.error('Failed to send verification email:', error);
      // Don't throw - user is still created, they can request email resend
    }

    return savedUser;
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    if (!user.passwordHash) return false;
    return bcryptjs.compare(password, user.passwordHash);
  }

  async markAsVerified(userId: string): Promise<void> {
    await this.usersRepo.update(userId, { isVerified: true });
  }

  // ─── OAuth ────────────────────────────────────────────────────────────────

  async findOrCreateOAuthUser(dto: {
    provider: string;
    providerId: string;
    email: string;
    displayName?: string;
    avatarUrl?: string;
    accessToken?: string;
  }): Promise<User> {
    // Check if OAuth account exists
    const existingOAuth = await this.oauthRepo.findOne({
      where: { provider: dto.provider, providerId: dto.providerId },
      relations: { user: true },
    });

    if (existingOAuth) {
      // Update access token
      existingOAuth.accessToken = dto.accessToken ?? null;
      await this.oauthRepo.save(existingOAuth);
      return existingOAuth.user;
    }

    // Check if user exists with this email
    let user = await this.findByEmail(dto.email);

    if (!user) {
      // Create new user
      user = this.usersRepo.create({
        email: dto.email,
        displayName: dto.displayName ?? dto.email.split('@')[0],
        avatarUrl: dto.avatarUrl ?? null,
        isVerified: true, // OAuth users are already verified
      });
      user = await this.usersRepo.save(user);
    }

    // Link OAuth account
    const oauthAccount = this.oauthRepo.create({
      user,
      provider: dto.provider,
      providerId: dto.providerId,
      accessToken: dto.accessToken ?? null,
    });
    await this.oauthRepo.save(oauthAccount);

    return user;
  }

  // ─── Sessions ─────────────────────────────────────────────────────────────

  async createSession(userId: string, appOrigin?: string): Promise<string> {
    // Generate a secure random token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const session = this.sessionsRepo.create({
      user,
      tokenHash,
      appOrigin: appOrigin ?? null,
      expiresAt,
    });

    await this.sessionsRepo.save(session);
    return rawToken; // Return unhashed token to store in cookie
  }

  async resolveSessionByToken(rawToken: string): Promise<User | null> {
    if (!rawToken) return null;

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const session = await this.sessionsRepo.findOne({
      where: { tokenHash },
      relations: { user: true },
    });

    if (!session) return null;

    if (session.expiresAt < new Date()) {
      await this.sessionsRepo.delete(session.id);
      return null;
    }

    return session.user;
  }

  async deleteSessionByToken(rawToken: string): Promise<void> {
    if (!rawToken) return;

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await this.sessionsRepo.delete({ tokenHash });
  }

  async deleteAllSessionsForUser(userId: string): Promise<void> {
    await this.sessionsRepo
      .createQueryBuilder()
      .delete()
      .where('user_id = :userId', { userId })
      .execute();
  }

  // ─── Email Verification ───────────────────────────────────────────────────

  async verifyEmail(token: string): Promise<User | null> {
    const user = await this.usersRepo.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new NotFoundException('Token không hợp lệ');
    }

    // Check if token has expired
    if (
      user.emailVerificationTokenExpiresAt &&
      user.emailVerificationTokenExpiresAt < new Date()
    ) {
      throw new NotFoundException('Token đã hết hạn');
    }

    // Mark email as verified
    user.isVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationTokenExpiresAt = null;

    return this.usersRepo.save(user);
  }

  async resendVerificationEmail(email: string): Promise<void> {
    const user = await this.findByEmail(email);

    if (!user) {
      throw new NotFoundException('Email không tồn tại');
    }

    if (user.isVerified) {
      throw new ConflictException('Email đã được xác nhận');
    }

    // Generate new verification token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const emailVerificationTokenExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    );

    user.emailVerificationToken = emailVerificationToken;
    user.emailVerificationTokenExpiresAt = emailVerificationTokenExpiresAt;

    await this.usersRepo.save(user);

    // Send verification email
    try {
      await this.mailService.sendVerificationEmail(
        user.email,
        emailVerificationToken,
      );
    } catch (error) {
      console.error('Failed to send verification email:', error);
      throw new Error('Không thể gửi email xác nhận');
    }
  }

  // ─── Password Reset ───────────────────────────────────────────────────────

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.findByEmail(email);

    if (!user) {
      // Don't reveal if email exists for security
      return;
    }

    // Generate password reset token (expires in 1 hour)
    const passwordResetToken = crypto.randomBytes(32).toString('hex');
    const passwordResetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

    user.passwordResetToken = passwordResetToken;
    user.passwordResetTokenExpiresAt = passwordResetTokenExpiresAt;

    await this.usersRepo.save(user);

    // Send password reset email
    try {
      await this.mailService.sendPasswordResetEmail(
        user.email,
        passwordResetToken,
        user.displayName ?? undefined,
      );
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      // Don't throw - we already saved the token
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<User> {
    if (newPassword.length < 8) {
      throw new ConflictException('Mật khẩu phải có ít nhất 8 ký tự');
    }

    const user = await this.usersRepo.findOne({
      where: { passwordResetToken: token },
    });

    if (!user) {
      throw new NotFoundException('Token không hợp lệ');
    }

    // Check if token has expired
    if (
      user.passwordResetTokenExpiresAt &&
      user.passwordResetTokenExpiresAt < new Date()
    ) {
      throw new NotFoundException('Token đã hết hạn');
    }

    // Update password
    user.passwordHash = await bcryptjs.hash(newPassword, 12);
    user.passwordResetToken = null;
    user.passwordResetTokenExpiresAt = null;

    return this.usersRepo.save(user);
  }
}

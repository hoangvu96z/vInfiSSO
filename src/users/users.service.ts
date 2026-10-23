import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcryptjs from 'bcryptjs';
import { User } from './user.entity';
import { OAuthAccount } from './oauth-account.entity';
import { Session } from './session.entity';
import { MailService } from '../mail/mail.service';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import type { ObjectStorage } from '../storage/object-storage';
import { LocalObjectStorage } from '../storage/local-object-storage';
import { LOCAL_UPLOAD_STORAGE } from '../storage/local-upload-storage.module';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_ROTATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_ROTATION_GRACE_MS = 2 * 60 * 1000;
const AVATAR_STORAGE_REFERENCE_PREFIX = Buffer.from('\0vinfi-upload:v1:');

function createAvatarStorageReference(storageKey: string): Buffer {
  return Buffer.concat([
    AVATAR_STORAGE_REFERENCE_PREFIX,
    Buffer.from(storageKey, 'utf8'),
  ]);
}

function parseAvatarStorageReference(value: Buffer): string | null {
  if (
    value.length <= AVATAR_STORAGE_REFERENCE_PREFIX.length ||
    !value
      .subarray(0, AVATAR_STORAGE_REFERENCE_PREFIX.length)
      .equals(AVATAR_STORAGE_REFERENCE_PREFIX)
  ) {
    return null;
  }
  const key = value
    .subarray(AVATAR_STORAGE_REFERENCE_PREFIX.length)
    .toString('utf8');
  return /^avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|gif|webp)$/.test(
    key,
  )
    ? key
    : null;
}

export interface ResolvedSession {
  user: User;
  rotatedToken?: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,

    @InjectRepository(OAuthAccount)
    private readonly oauthRepo: Repository<OAuthAccount>,

    @InjectRepository(Session)
    private readonly sessionsRepo: Repository<Session>,

    private readonly mailService: MailService,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    @Inject(LOCAL_UPLOAD_STORAGE)
    private readonly uploadStorage: ObjectStorage = new LocalObjectStorage(
      path.join(process.cwd(), 'uploads'),
    ),
  ) {}

  private getSessionRotationSecret(): string | null {
    const secret = this.configService.get<string>('SESSION_SECRET')?.trim();
    return secret && secret.length >= 32 ? secret : null;
  }

  private hashSessionToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  private deriveRotatedSessionToken(
    parentTokenHash: string,
    secret: string,
  ): string {
    const mac = crypto
      .createHmac('sha256', secret)
      .update(`vinfisso:sso-session-rotation:v1:${parentTokenHash}`)
      .digest('hex');
    return `v1.${parentTokenHash}.${mac}`;
  }

  private getRotatedTokenParentHash(
    rawToken: string,
    secret: string,
  ): string | null {
    const match = /^v1\.([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(rawToken);
    if (!match) return null;

    const [, parentTokenHash, suppliedMac] = match;
    const expectedMac = crypto
      .createHmac('sha256', secret)
      .update(`vinfisso:sso-session-rotation:v1:${parentTokenHash}`)
      .digest();
    const actualMac = Buffer.from(suppliedMac, 'hex');
    if (
      actualMac.length !== expectedMac.length ||
      !crypto.timingSafeEqual(actualMac, expectedMac)
    ) {
      return null;
    }
    return parentTokenHash;
  }

  private digestActionToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

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
      emailVerificationToken: this.digestActionToken(emailVerificationToken),
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

  // ─── Profile ──────────────────────────────────────────────────────────────

  async updateProfile(
    userId: string,
    dto: { displayName?: string; avatarUrl?: string | null },
  ): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (dto.displayName !== undefined) {
      const name = dto.displayName?.trim();
      if (!name)
        throw new ConflictException('Tên hiển thị không được để trống');
      user.displayName = name.substring(0, 100);
    }

    if (dto.avatarUrl !== undefined) {
      user.avatarUrl = dto.avatarUrl ?? null;
    }

    return this.usersRepo.save(user);
  }

  async updateAvatar(
    userId: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<User> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const extensionByMime: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
    };
    const extension = extensionByMime[contentType];
    if (!extension) throw new ConflictException('Unsupported avatar format');

    const storageKey = `avatars/${crypto.randomUUID()}.${extension}`;
    await this.uploadStorage.put(storageKey, buffer, contentType);

    user.avatar = createAvatarStorageReference(storageKey);
    user.avatarContentType = contentType;
    user.avatarUrl = null;

    try {
      return await this.usersRepo.save(user);
    } catch (error) {
      await this.deleteUploadBestEffort(storageKey);
      throw error;
    }
  }

  async findAvatar(
    userId: string,
  ): Promise<{ buffer: Buffer | null; contentType: string | null } | null> {
    const user = await this.findById(userId);
    if (!user || !user.avatar) return null;

    const storageKey = parseAvatarStorageReference(user.avatar);
    if (storageKey) {
      const buffer = await this.uploadStorage.get(storageKey);
      if (!buffer) return null;
      return { buffer, contentType: user.avatarContentType };
    }

    return { buffer: user.avatar, contentType: user.avatarContentType };
  }

  private async deleteUploadBestEffort(key: string): Promise<void> {
    try {
      await this.uploadStorage.delete(key);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Could not clean up an avatar upload: ${detail}`);
    }
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

  async createSession(
    userId: string,
    appOrigin?: string,
    ttlMs = SESSION_TTL_MS,
  ): Promise<string> {
    // Generate a secure random token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const expiresAt = new Date(Date.now() + ttlMs);

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

  async consumeOAuthLoginCode(
    rawCode: string,
    appOrigin: string,
  ): Promise<User> {
    if (!/^[a-f0-9]{64}$/.test(rawCode)) {
      throw new UnauthorizedException(
        'Mã đăng nhập không hợp lệ hoặc đã hết hạn',
      );
    }
    const tokenHash = crypto.createHash('sha256').update(rawCode).digest('hex');
    const userId = await this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        'SELECT id, user_id, expires_at FROM sessions WHERE token_hash = $1 AND app_origin = $2 FOR UPDATE',
        [tokenHash, appOrigin],
      )) as unknown as Array<{
        id: string;
        user_id: string;
        expires_at: Date;
      }>;
      const session = rows[0];
      if (!session || new Date(session.expires_at) <= new Date()) {
        throw new UnauthorizedException(
          'Mã đăng nhập không hợp lệ hoặc đã hết hạn',
        );
      }
      await manager.query('DELETE FROM sessions WHERE id = $1', [session.id]);
      return session.user_id;
    });
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('Tài khoản không còn tồn tại');
    return user;
  }

  async resolveSessionByToken(rawToken: string): Promise<User | null> {
    if (!rawToken) return null;

    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

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

  /**
   * Resolve a session for an authenticated request and rotate it near expiry.
   * The existing session row is locked while the replacement is created. The
   * replacement token is deterministic for the old token and server secret, so
   * concurrent requests carrying the old cookie can only reissue the same
   * replacement cookie during the short grace period.
   */
  async resolveSessionForRequest(
    rawToken: string,
  ): Promise<ResolvedSession | null> {
    if (!rawToken) return null;

    const tokenHash = this.hashSessionToken(rawToken);
    const rotationSecret = this.getSessionRotationSecret();
    const currentSession = await this.sessionsRepo.findOne({
      where: { tokenHash },
      relations: { user: true },
    });
    if (!currentSession) return null;

    const initialNow = new Date();
    if (currentSession.expiresAt <= initialNow) {
      await this.sessionsRepo.delete(currentSession.id);
      return null;
    }
    if (
      !rotationSecret ||
      currentSession.expiresAt.getTime() - initialNow.getTime() >
        SESSION_ROTATION_WINDOW_MS
    ) {
      return { user: currentSession.user };
    }

    return this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        'SELECT id, user_id, app_origin, expires_at FROM sessions WHERE token_hash = $1 FOR UPDATE',
        [tokenHash],
      )) as unknown as Array<{
        id: string;
        user_id: string;
        app_origin: string | null;
        expires_at: Date | string;
      }>;
      const session = rows[0];
      if (!session) return null;

      const now = new Date();
      const expiresAt = new Date(session.expires_at);
      if (expiresAt <= now) {
        await manager.query('DELETE FROM sessions WHERE id = $1', [session.id]);
        return null;
      }

      const user = await manager
        .getRepository(User)
        .findOne({ where: { id: session.user_id } });
      if (!user) return null;

      const remainingMs = expiresAt.getTime() - now.getTime();
      if (!rotationSecret || remainingMs > SESSION_ROTATION_WINDOW_MS) {
        return { user };
      }

      const rotatedToken = this.deriveRotatedSessionToken(
        tokenHash,
        rotationSecret,
      );
      const rotatedTokenHash = this.hashSessionToken(rotatedToken);
      const childRows = (await manager.query(
        'SELECT id FROM sessions WHERE token_hash = $1 AND user_id = $2 AND expires_at > $3',
        [rotatedTokenHash, session.user_id, now],
      )) as unknown as Array<{ id: string }>;
      const hasActiveReplacement = childRows.length > 0;

      // An old token is still accepted briefly after rotation. Reissue exactly
      // the same child token during this window, never mint another one.
      if (remainingMs <= SESSION_ROTATION_GRACE_MS && hasActiveReplacement) {
        return { user, rotatedToken };
      }

      if (!hasActiveReplacement) {
        const sessionsRepository = manager.getRepository(Session);
        await sessionsRepository.save(
          sessionsRepository.create({
            user: { id: session.user_id } as User,
            tokenHash: rotatedTokenHash,
            appOrigin: session.app_origin,
            expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
          }),
        );
      }

      // Retain the presented token for a brief recovery window. The row lock
      // ensures only one replacement is inserted, and the deterministic child
      // prevents concurrent responses from setting different cookies.
      await manager.query('UPDATE sessions SET expires_at = $1 WHERE id = $2', [
        new Date(now.getTime() + SESSION_ROTATION_GRACE_MS),
        session.id,
      ]);
      return { user, rotatedToken };
    });
  }

  async deleteSessionByToken(rawToken: string): Promise<void> {
    if (!rawToken) return;

    const tokenHash = this.hashSessionToken(rawToken);
    const rotationSecret = this.getSessionRotationSecret();
    const parentTokenHash = rotationSecret
      ? this.getRotatedTokenParentHash(rawToken, rotationSecret)
      : null;
    const tokenHashes = parentTokenHash
      ? [parentTokenHash, tokenHash]
      : [tokenHash];
    if (rotationSecret) {
      tokenHashes.push(
        this.hashSessionToken(
          this.deriveRotatedSessionToken(tokenHash, rotationSecret),
        ),
      );
    }
    const uniqueTokenHashes = [...new Set(tokenHashes)];

    await this.dataSource.transaction(async (manager) => {
      // Lock ancestors, the presented session, then descendants. Concurrent
      // parent/child logouts therefore acquire shared rows in the same order.
      await manager.query(
        'SELECT token_hash FROM sessions WHERE token_hash = ANY($1::varchar[]) ORDER BY array_position($1::varchar[], token_hash) FOR UPDATE',
        [uniqueTokenHashes],
      );
      await manager.query(
        'DELETE FROM sessions WHERE token_hash = ANY($1::varchar[])',
        [uniqueTokenHashes],
      );
    });
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
    const tokenDigest = this.digestActionToken(token);
    const user = await this.usersRepo.findOne({
      where: {
        emailVerificationToken: tokenDigest,
      },
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

    const savedUser = await this.usersRepo.save(user);

    // Xoá tất cả sessions cũ → bắt buộc user phải đăng nhập lại
    await this.deleteAllSessionsForUser(savedUser.id);

    return savedUser;
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

    user.emailVerificationToken = this.digestActionToken(
      emailVerificationToken,
    );
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

    user.passwordResetToken = this.digestActionToken(passwordResetToken);
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

    const passwordHash = await bcryptjs.hash(newPassword, 12);
    const tokenDigest = this.digestActionToken(token);
    return this.dataSource.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.passwordResetToken = :tokenDigest', { tokenDigest })
        .getOne();
      if (!user) throw new NotFoundException('Token không hợp lệ');
      if (
        !user.passwordResetTokenExpiresAt ||
        user.passwordResetTokenExpiresAt < new Date()
      ) {
        throw new NotFoundException('Token đã hết hạn');
      }

      user.passwordHash = passwordHash;
      user.passwordResetToken = null;
      user.passwordResetTokenExpiresAt = null;
      const saved = await manager.getRepository(User).save(user);
      await manager
        .getRepository(Session)
        .createQueryBuilder()
        .delete()
        .where('user_id = :userId', { userId: user.id })
        .execute();
      return saved;
    });
  }
}

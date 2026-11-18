import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { SsoService } from './sso.service';
import type { UsersService } from '../users/users.service';
import type { AuditLog } from '../users/audit-log.entity';
import type { User } from '../users/user.entity';

describe('SsoService logout', () => {
  it('revokes only the presented session token and audits the user', async () => {
    const usersService = {
      resolveSessionByToken: jest.fn().mockResolvedValue({ id: 'user-1' }),
      deleteSessionByToken: jest.fn().mockResolvedValue(undefined),
      deleteAllSessionsForUser: jest.fn().mockResolvedValue(undefined),
    };
    const auditLogRepo = {
      save: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SsoService(
      usersService as unknown as UsersService,
      auditLogRepo as unknown as Repository<AuditLog>,
    );

    await service.logout('presented-session-token');

    expect(usersService.deleteSessionByToken).toHaveBeenCalledTimes(1);
    expect(usersService.deleteSessionByToken).toHaveBeenCalledWith(
      'presented-session-token',
    );
    expect(usersService.deleteAllSessionsForUser).not.toHaveBeenCalled();
    expect(auditLogRepo.save).toHaveBeenCalledWith({
      userId: 'user-1',
      action: 'logout',
      app: 'sso',
    });
  });

  it('still revokes the presented token when it no longer resolves to a user', async () => {
    const usersService = {
      resolveSessionByToken: jest.fn().mockResolvedValue(null),
      deleteSessionByToken: jest.fn().mockResolvedValue(undefined),
      deleteAllSessionsForUser: jest.fn().mockResolvedValue(undefined),
    };
    const auditLogRepo = { save: jest.fn() };
    const service = new SsoService(
      usersService as unknown as UsersService,
      auditLogRepo as unknown as Repository<AuditLog>,
    );

    await service.logout('expired-session-token');

    expect(usersService.deleteSessionByToken).toHaveBeenCalledWith(
      'expired-session-token',
    );
    expect(usersService.deleteAllSessionsForUser).not.toHaveBeenCalled();
    expect(auditLogRepo.save).not.toHaveBeenCalled();
  });
});

describe('SsoService sanitizeUser', () => {
  it('populates avatarUrl for custom uploaded avatar using configured SSO_BASE_URL and strips binary/sensitive fields', () => {
    const configService = {
      get: jest.fn((key: string) =>
        key === 'SSO_BASE_URL' ? 'https://sso.vunph.click/' : undefined,
      ),
    };
    const service = new SsoService(
      {} as unknown as UsersService,
      { save: jest.fn() } as unknown as Repository<AuditLog>,
      configService as unknown as ConfigService,
    );

    const sanitized = service.sanitizeUser({
      id: 'user-avatar-123',
      email: 'vu@vunph.id.vn',
      displayName: 'Hoàng Vũ',
      avatarUrl: null,
      avatar: Buffer.from('storage:avatars/user-avatar-123.png'),
      avatarContentType: 'image/png',
      passwordHash: 'secret-hash',
      emailVerificationToken: 'verify-tok',
      passwordResetToken: 'reset-tok',
    } as unknown as User);

    expect(sanitized.avatarUrl).toBe(
      'https://sso.vunph.click/sso/avatar/user-avatar-123',
    );
    expect(sanitized.avatar).toBeUndefined();
    expect(sanitized.avatarContentType).toBeUndefined();
    expect(sanitized.passwordHash).toBeUndefined();
    expect(sanitized.emailVerificationToken).toBeUndefined();
    expect(sanitized.passwordResetToken).toBeUndefined();
  });

  it('preserves existing external OAuth avatarUrl and leaves avatarUrl null when no avatar is uploaded', () => {
    const service = new SsoService(
      {} as unknown as UsersService,
      { save: jest.fn() } as unknown as Repository<AuditLog>,
    );

    const oauthSanitized = service.sanitizeUser({
      id: 'user-oauth-1',
      email: 'oauth@vunph.id.vn',
      avatarUrl: 'https://lh3.googleusercontent.com/a/photo',
      avatar: Buffer.from('unused'),
      avatarContentType: 'image/jpeg',
    } as unknown as User);
    expect(oauthSanitized.avatarUrl).toBe(
      'https://lh3.googleusercontent.com/a/photo',
    );

    const plainSanitized = service.sanitizeUser({
      id: 'user-plain-1',
      email: 'plain@vunph.id.vn',
      avatarUrl: null,
      avatar: null,
      avatarContentType: null,
    } as unknown as User);
    expect(plainSanitized.avatarUrl).toBeNull();
  });
});

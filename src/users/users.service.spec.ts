import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import type { DeepPartial, EntityManager, Repository } from 'typeorm';
import type { MailService } from '../mail/mail.service';
import { OAuthAccount } from './oauth-account.entity';
import { User } from './user.entity';
import { Session } from './session.entity';
import { UsersService } from './users.service';

describe('UsersService password reset', () => {
  type ResetTestUser = Pick<
    User,
    | 'id'
    | 'email'
    | 'passwordHash'
    | 'passwordResetToken'
    | 'passwordResetTokenExpiresAt'
  >;
  let currentUser: ResetTestUser | null;
  const userQuery = {
    setLock: jest.fn<unknown, [string]>(),
    where: jest.fn<unknown, [string, Record<string, unknown>]>(),
    getOne: jest.fn<Promise<ResetTestUser | null>, []>(),
  };
  const sessionQuery = {
    delete: jest.fn<unknown, []>(),
    where: jest.fn<unknown, [string, Record<string, unknown>]>(),
    execute: jest
      .fn<Promise<{ affected: number }>, []>()
      .mockResolvedValue({ affected: 1 }),
  };
  const userRepository = {
    findOne: jest.fn<Promise<ResetTestUser | null>, [unknown?]>(),
    createQueryBuilder: jest.fn(() => userQuery),
    save: jest.fn((user: ResetTestUser) => {
      currentUser = user;
      return Promise.resolve(user);
    }),
  };
  const sessionRepository = { createQueryBuilder: jest.fn(() => sessionQuery) };
  const manager = {
    query: jest.fn<Promise<unknown>, [string, unknown[]?]>(),
    getRepository: jest.fn((entity: unknown): unknown => {
      if (entity === User) return userRepository;
      if (entity === Session) return sessionRepository;
      throw new Error('Unexpected repository');
    }),
  };
  const dataSource = {
    transaction: <T>(callback: (manager: EntityManager) => Promise<T>) =>
      callback(manager as unknown as EntityManager),
  };
  const usersRepository = {
    findOne: jest.fn<Promise<User | null>, [unknown?]>(),
  };
  const service = new UsersService(
    usersRepository as unknown as Repository<User>,
    {} as unknown as Repository<OAuthAccount>,
    {} as unknown as Repository<Session>,
    {} as unknown as MailService,
    dataSource as unknown as import('typeorm').DataSource,
    {
      get: jest.fn<unknown, [string]>(() => 'x'.repeat(32)),
    } as unknown as ConfigService,
  );
  let oauthCodeConsumed: boolean;

  beforeEach(() => {
    jest.clearAllMocks();
    userQuery.setLock.mockImplementation(() => userQuery);
    userQuery.where.mockImplementation(() => userQuery);
    userQuery.getOne.mockImplementation(() =>
      Promise.resolve(currentUser?.passwordResetToken ? currentUser : null),
    );
    sessionQuery.delete.mockImplementation(() => sessionQuery);
    sessionQuery.where.mockImplementation(() => sessionQuery);
    currentUser = {
      id: 'user-1',
      email: 'member@example.test',
      passwordHash: null,
      passwordResetToken: crypto
        .createHash('sha256')
        .update('one-time-reset-token')
        .digest('hex'),
      passwordResetTokenExpiresAt: new Date(Date.now() + 60_000),
    };
    usersRepository.findOne.mockResolvedValue(
      Object.assign(new User(), {
        id: 'oauth-user-1',
        email: 'oauth@example.test',
      }),
    );
    oauthCodeConsumed = false;
    manager.query.mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT id, user_id, expires_at FROM sessions')) {
        return Promise.resolve(
          oauthCodeConsumed
            ? []
            : [
                {
                  id: 'oauth-code-session',
                  user_id: 'oauth-user-1',
                  expires_at: new Date(Date.now() + 60_000),
                },
              ],
        );
      }
      if (sql.startsWith('DELETE FROM sessions')) {
        oauthCodeConsumed = true;
      }
      return Promise.resolve([]);
    });
  });

  it('consumes the reset token under a row lock and revokes existing sessions', async () => {
    const updated = await service.resetPassword(
      'one-time-reset-token',
      'new-password-123',
    );

    expect(userQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(userQuery.where).toHaveBeenCalledWith(
      'user.passwordResetToken IN (:...candidates)',
      {
        candidates: [
          crypto
            .createHash('sha256')
            .update('one-time-reset-token')
            .digest('hex'),
          'one-time-reset-token',
        ],
      },
    );
    expect(updated.passwordResetToken).toBeNull();
    expect(updated.passwordResetTokenExpiresAt).toBeNull();
    expect(updated.passwordHash).toBeTruthy();
    expect(sessionQuery.delete).toHaveBeenCalled();
    expect(sessionQuery.where).toHaveBeenCalledWith('user_id = :userId', {
      userId: 'user-1',
    });
  });

  it('rejects replay after the token has been cleared', async () => {
    await service.resetPassword('one-time-reset-token', 'new-password-123');
    await expect(
      service.resetPassword('one-time-reset-token', 'another-password-123'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(userRepository.save).toHaveBeenCalledTimes(1);
  });

  it('consumes an OAuth code once and binds it to its redirect origin', async () => {
    const code = 'a'.repeat(64);
    const user = await service.consumeOAuthLoginCode(
      code,
      'https://app.example.test',
    );

    expect(user.id).toBe('oauth-user-1');
    expect(manager.query).toHaveBeenNthCalledWith(
      1,
      'SELECT id, user_id, expires_at FROM sessions WHERE token_hash = $1 AND app_origin = $2 FOR UPDATE',
      [
        crypto.createHash('sha256').update(code).digest('hex'),
        'https://app.example.test',
      ],
    );
    expect(manager.query).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM sessions WHERE id = $1',
      ['oauth-code-session'],
    );
    await expect(
      service.consumeOAuthLoginCode(code, 'https://app.example.test'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('UsersService action token storage', () => {
  const userRepository = {
    findOne: jest.fn<Promise<User | null>, [unknown?]>(),
    create: jest.fn<User, [DeepPartial<User>]>((value) =>
      Object.assign(new User(), value),
    ),
    save: jest.fn<Promise<User>, [User]>((user) => Promise.resolve(user)),
  };
  const mailService = {
    sendVerificationEmail: jest
      .fn<Promise<void>, [string, string, string?]>()
      .mockResolvedValue(undefined),
    sendPasswordResetEmail: jest
      .fn<Promise<void>, [string, string, string?]>()
      .mockResolvedValue(undefined),
  };
  const service = new UsersService(
    userRepository as unknown as Repository<User>,
    {} as unknown as Repository<OAuthAccount>,
    {} as unknown as Repository<Session>,
    mailService as unknown as MailService,
    {} as unknown as import('typeorm').DataSource,
    {
      get: jest.fn<unknown, [string]>(() => 'x'.repeat(32)),
    } as unknown as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository.findOne.mockResolvedValue(null);
    userRepository.create.mockImplementation((value) =>
      Object.assign(new User(), value),
    );
    userRepository.save.mockImplementation((user) => Promise.resolve(user));
  });

  it('stores only a digest of the registration verification token', async () => {
    await service.createUser({ email: 'member@example.test' });

    const rawToken = mailService.sendVerificationEmail.mock.calls[0]?.[1];
    if (!rawToken) throw new Error('Expected verification token to be sent');
    const tokenDigest = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerificationToken: tokenDigest }),
    );
    expect(
      userRepository.save.mock.calls[0]?.[0].emailVerificationToken,
    ).not.toBe(rawToken);
    expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
      'member@example.test',
      rawToken,
    );
  });

  it('stores only a digest of password reset tokens while emailing the raw token', async () => {
    const user = Object.assign(new User(), {
      id: 'user-1',
      email: 'member@example.test',
      displayName: 'Member',
      passwordResetToken: null as string | null,
      passwordResetTokenExpiresAt: null as Date | null,
    });
    userRepository.findOne.mockResolvedValue(user);
    await service.requestPasswordReset(user.email);

    const rawToken = mailService.sendPasswordResetEmail.mock.calls[0]?.[1];
    if (!rawToken) throw new Error('Expected password reset token to be sent');
    const tokenDigest = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ passwordResetToken: tokenDigest }),
    );
    expect(user.passwordResetToken).not.toBe(rawToken);
    expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      user.email,
      rawToken,
      user.displayName,
    );
  });
});

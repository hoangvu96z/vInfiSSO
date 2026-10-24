import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import type { MailService } from '../mail/mail.service';
import type { ObjectStorage } from '../storage/object-storage';
import { OAuthAccount } from './oauth-account.entity';
import { Session } from './session.entity';
import { User } from './user.entity';
import { UsersService } from './users.service';

function createService(options: {
  user: User | null;
  storage?: Partial<jest.Mocked<ObjectStorage>>;
  save?: jest.Mock<Promise<User>, [User]>;
}) {
  const userRepo = {
    findOne: jest
      .fn<Promise<User | null>, [unknown?]>()
      .mockResolvedValue(options.user),
    save:
      options.save ||
      jest.fn<Promise<User>, [User]>((user) => Promise.resolve(user)),
  };
  const storage: jest.Mocked<ObjectStorage> = {
    put: jest
      .fn<Promise<void>, [string, Buffer, string]>()
      .mockResolvedValue(undefined),
    get: jest.fn<Promise<Buffer | null>, [string]>().mockResolvedValue(null),
    delete: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    ...options.storage,
  };
  const service = new UsersService(
    userRepo as unknown as Repository<User>,
    {} as unknown as Repository<OAuthAccount>,
    {} as unknown as Repository<Session>,
    {} as unknown as MailService,
    {} as unknown as DataSource,
    {} as unknown as ConfigService,
    storage,
  );
  return { service, userRepo, storage };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    avatar: null,
    avatarContentType: null,
    avatarUrl: null,
    ...overrides,
  } as User;
}

describe('UsersService avatar storage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stores new avatars under the private upload tree and persists a private reference', async () => {
    const user = makeUser({ avatar: Buffer.from('legacy') });
    const { service, storage, userRepo } = createService({ user });
    const image = Buffer.from('new avatar');

    await service.updateAvatar('user-1', image, 'image/webp');

    const putCall = storage.put.mock.calls[0];
    expect(putCall?.[0]).toMatch(/^avatars\/[0-9a-f-]+\.webp$/);
    expect(putCall?.[1]).toBe(image);
    expect(putCall?.[2]).toBe('image/webp');
    const storageKey = putCall?.[0];
    if (!storageKey) throw new Error('Expected the avatar storage key');
    expect(storageKey).toMatch(/^avatars\/[0-9a-f-]+\.webp$/);
    expect(user.avatar).toEqual(
      Buffer.from(`\0vinfi-upload:v1:${storageKey}`, 'utf8'),
    );
    expect(user.avatarContentType).toBe('image/webp');
    expect(userRepo.save.mock.calls[0]?.[0]).toBe(user);
    expect(storage.delete.mock.calls).toHaveLength(0);
  });

  it('removes a newly written avatar and preserves the previous managed avatar if the database update fails', async () => {
    const previousKey = 'avatars/123e4567-e89b-12d3-a456-426614174000.webp';
    const user = makeUser({
      avatar: Buffer.from(`\0vinfi-upload:v1:${previousKey}`),
    });
    const save = jest
      .fn<Promise<User>, [User]>()
      .mockRejectedValue(new Error('database unavailable'));
    const { service, storage } = createService({ user, save });

    await expect(
      service.updateAvatar('user-1', Buffer.from('new avatar'), 'image/png'),
    ).rejects.toThrow('database unavailable');
    expect(storage.put.mock.calls).toHaveLength(1);
    expect(storage.delete.mock.calls).toHaveLength(1);
    expect(storage.delete.mock.calls[0]?.[0]).toMatch(
      /^avatars\/[0-9a-f-]+\.png$/,
    );
    expect(storage.delete.mock.calls[0]?.[0]).not.toBe(previousKey);
  });

  it('best-effort deletes the previous managed avatar only after the database update succeeds', async () => {
    const previousKey = 'avatars/123e4567-e89b-12d3-a456-426614174000.webp';
    const user = makeUser({
      avatar: Buffer.from(`\0vinfi-upload:v1:${previousKey}`),
    });
    const events: string[] = [];
    const save = jest.fn<Promise<User>, [User]>((savedUser) => {
      events.push('db:save');
      expect(storage.delete.mock.calls).toHaveLength(0);
      return Promise.resolve(savedUser);
    });
    const { service, storage } = createService({
      user,
      save,
      storage: {
        put: jest.fn<Promise<void>, [string, Buffer, string]>(() => {
          events.push('storage:put');
          return Promise.resolve();
        }),
        delete: jest.fn<Promise<void>, [string]>((key) => {
          events.push(`storage:delete:${key}`);
          return Promise.reject(new Error('disk cleanup warning'));
        }),
      },
    });

    await expect(
      service.updateAvatar('user-1', Buffer.from('replacement'), 'image/png'),
    ).resolves.toBe(user);

    expect(storage.delete.mock.calls).toEqual([[previousKey]]);
    expect(events).toEqual([
      'storage:put',
      'db:save',
      `storage:delete:${previousKey}`,
    ]);
  });

  it('does not delete when the replacement key is unchanged or when previous values are external or legacy', async () => {
    const sameUuid = '123e4567-e89b-12d3-a456-426614174000';
    const sameKey = `avatars/${sameUuid}.webp`;

    const unchangedKeyUser = makeUser({
      avatar: Buffer.from(`\0vinfi-upload:v1:${sameKey}`),
    });
    const unchangedSetup = createService({ user: unchangedKeyUser });
    jest
      .spyOn(
        unchangedSetup.service as unknown as {
          createAvatarStorageKey: (extension: string) => string;
        },
        'createAvatarStorageKey',
      )
      .mockReturnValue(sameKey);
    await unchangedSetup.service.updateAvatar(
      'user-1',
      Buffer.from('same key content'),
      'image/webp',
    );
    expect(unchangedSetup.storage.delete.mock.calls).toHaveLength(0);

    const externalUrlUser = makeUser({
      avatar: null,
      avatarUrl: 'https://cdn.example.test/avatars/external.png',
    });
    const externalSetup = createService({ user: externalUrlUser });
    await externalSetup.service.updateAvatar(
      'user-1',
      Buffer.from('uploaded replacement'),
      'image/png',
    );
    expect(externalSetup.storage.delete.mock.calls).toHaveLength(0);

    const unmanagedRefUser = makeUser({
      avatar: Buffer.from('\0vinfi-upload:v1:contacts/secret.png'),
    });
    const unmanagedSetup = createService({ user: unmanagedRefUser });
    await unmanagedSetup.service.updateAvatar(
      'user-1',
      Buffer.from('uploaded replacement'),
      'image/png',
    );
    expect(unmanagedSetup.storage.delete.mock.calls).toHaveLength(0);
  });

  it('reads file-backed avatars first and falls back to legacy bytea', async () => {
    const diskAvatar = Buffer.from('disk avatar');
    const user = makeUser({
      avatar: Buffer.from(
        '\0vinfi-upload:v1:avatars/123e4567-e89b-12d3-a456-426614174000.webp',
      ),
      avatarContentType: 'image/webp',
    });
    const { service, storage } = createService({
      user,
      storage: { get: jest.fn().mockResolvedValueOnce(diskAvatar) },
    });

    await expect(service.findAvatar('user-1')).resolves.toEqual({
      buffer: diskAvatar,
      contentType: 'image/webp',
    });

    storage.get.mockResolvedValueOnce(null);
    await expect(service.findAvatar('user-1')).resolves.toBeNull();
  });

  it('continues serving avatars stored in legacy bytea', async () => {
    const legacyAvatar = Buffer.from('legacy avatar');
    const user = makeUser({
      avatar: legacyAvatar,
      avatarContentType: 'image/png',
    });
    const { service, storage } = createService({ user });

    await expect(service.findAvatar('user-1')).resolves.toEqual({
      buffer: legacyAvatar,
      contentType: 'image/png',
    });
    expect(storage.get.mock.calls).toHaveLength(0);
  });

  it('does not treat arbitrary uploaded bytes as an internal storage reference', async () => {
    const fakeReference = Buffer.from('\0vinfi-upload:v1:contacts/secret.png');
    const user = makeUser({
      avatar: fakeReference,
      avatarContentType: 'image/png',
    });
    const { service, storage } = createService({ user });

    await expect(service.findAvatar('user-1')).resolves.toEqual({
      buffer: fakeReference,
      contentType: 'image/png',
    });
    expect(storage.get.mock.calls).toHaveLength(0);
  });
});

import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import type { MailService } from '../mail/mail.service';
import type { ObjectStorage } from '../storage/object-storage';
import { User } from './user.entity';
import { UsersService } from './users.service';

function createService(options: {
  user: User | null;
  storage?: Partial<ObjectStorage>;
  save?: jest.Mock;
}) {
  const userRepo = {
    findOne: jest.fn().mockResolvedValue(options.user),
    save: options.save || jest.fn().mockImplementation((user) => user),
  };
  const storage: ObjectStorage = {
    put: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(undefined),
    ...options.storage,
  };
  const service = new UsersService(
    userRepo as unknown as Repository<User>,
    {} as any,
    {} as any,
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
  it('stores new avatars under the private upload tree and persists a private reference', async () => {
    const user = makeUser({ avatar: Buffer.from('legacy') });
    const { service, storage, userRepo } = createService({ user });
    const image = Buffer.from('new avatar');

    await service.updateAvatar('user-1', image, 'image/webp');

    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^avatars\/[0-9a-f-]+\.webp$/),
      image,
      'image/webp',
    );
    const storageKey = (storage.put as jest.Mock).mock.calls[0][0] as string;
    expect(storageKey).toMatch(/^avatars\/[0-9a-f-]+\.webp$/);
    expect(user.avatar).toEqual(
      Buffer.from(`\0vinfi-upload:v1:${storageKey}`, 'utf8'),
    );
    expect(user.avatarContentType).toBe('image/webp');
    expect(userRepo.save.mock.calls[0][0]).toBe(user);
  });

  it('removes a newly written avatar if the database update fails', async () => {
    const user = makeUser({ avatar: Buffer.from('legacy') });
    const save = jest.fn().mockRejectedValue(new Error('database unavailable'));
    const { service, storage } = createService({ user, save });

    await expect(
      service.updateAvatar('user-1', Buffer.from('new avatar'), 'image/png'),
    ).rejects.toThrow('database unavailable');
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(
      expect.stringMatching(/^avatars\/[0-9a-f-]+\.png$/),
    );
  });

  it('retains replaced avatar files so sequential backups can restore older DB snapshots', async () => {
    const user = makeUser({
      avatar: Buffer.from(
        '\0vinfi-upload:v1:avatars/123e4567-e89b-12d3-a456-426614174000.webp',
      ),
    });
    const { service, storage } = createService({ user });

    await service.updateAvatar(
      'user-1',
      Buffer.from('replacement'),
      'image/png',
    );

    expect(storage.delete).not.toHaveBeenCalled();
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

    (storage.get as jest.Mock).mockResolvedValueOnce(null);
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
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('does not treat arbitrary uploaded bytes as an internal storage reference', async () => {
    const fakeReference = Buffer.from('\0vinfi-upload:v1:contacts/secret.png');
    const user = makeUser({ avatar: fakeReference, avatarContentType: 'image/png' });
    const { service, storage } = createService({ user });

    await expect(service.findAvatar('user-1')).resolves.toEqual({
      buffer: fakeReference,
      contentType: 'image/png',
    });
    expect(storage.get).not.toHaveBeenCalled();
  });
});

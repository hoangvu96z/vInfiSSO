import { ContactService } from './contact.service';
import type { Repository } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import type { MailService } from '../mail/mail.service';
import type { ContactMessage } from './contact-message.entity';
import { BadRequestException } from '@nestjs/common';
import type { ObjectStorage } from '../storage/object-storage';
import * as crypto from 'node:crypto';

type NotificationEmailService = {
  sendNotificationEmail(message: ContactMessage): Promise<void>;
};

function notificationEmailService(
  service: ContactService,
): NotificationEmailService {
  return service as unknown as NotificationEmailService;
}

describe('ContactService guest session token', () => {
  const service = new ContactService(
    {} as unknown as Repository<ContactMessage>,
    {} as unknown as MailService,
    {
      get: () => 'test-signing-secret-which-is-at-least-32-chars',
    } as unknown as ConfigService,
  );

  it('binds a replayable 90-day HMAC token to one session id', () => {
    const token = service.createGuestSessionToken('session-1');

    expect(service.isValidGuestSessionToken('session-1', token)).toBe(true);
    expect(service.isValidGuestSessionToken('session-1', token)).toBe(true);
    expect(service.isValidGuestSessionToken('session-2', token)).toBe(false);
    expect(
      service.isValidGuestSessionToken('session-1', `${token}tampered`),
    ).toBe(false);
  });

  it('rejects expired, overly distant, or malformed guest tokens', () => {
    const secret = 'test-signing-secret-which-is-at-least-32-chars';
    const now = Math.floor(Date.now() / 1000);

    const expiredExpiresAt = now - 60;
    const expiredSignature = crypto
      .createHmac('sha256', secret)
      .update(`session-1:${expiredExpiresAt}`)
      .digest('base64url');
    expect(
      service.isValidGuestSessionToken(
        'session-1',
        `${expiredExpiresAt}.${expiredSignature}`,
      ),
    ).toBe(false);

    const excessiveExpiresAt = now + 91 * 24 * 60 * 60;
    const excessiveSignature = crypto
      .createHmac('sha256', secret)
      .update(`session-1:${excessiveExpiresAt}`)
      .digest('base64url');
    expect(
      service.isValidGuestSessionToken(
        'session-1',
        `${excessiveExpiresAt}.${excessiveSignature}`,
      ),
    ).toBe(false);

    expect(service.isValidGuestSessionToken('session-1', undefined)).toBe(
      false,
    );
    expect(service.isValidGuestSessionToken('session-1', '')).toBe(false);
    expect(
      service.isValidGuestSessionToken('session-1', 'malformed-token'),
    ).toBe(false);
    expect(service.isValidGuestSessionToken('session-1', '12345.short')).toBe(
      false,
    );
  });
});

describe('ContactService contact image persistence', () => {
  it('stores multi-image uploads in private storage and writes only keys to the database', async () => {
    const images = [
      { data: 'first-base64', mime: 'image/jpeg' },
      { data: 'second-base64', mime: 'image/webp' },
    ];
    const storage = {
      put: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    } satisfies ObjectStorage;
    const repository = {
      create: jest.fn((message: ContactMessage) => message),
      save: jest.fn((message: ContactMessage) => Promise.resolve(message)),
    };
    const service = new ContactService(
      repository as unknown as Repository<ContactMessage>,
      {} as unknown as MailService,
      { get: () => undefined } as unknown as ConfigService,
      storage,
    );
    jest
      .spyOn(notificationEmailService(service), 'sendNotificationEmail')
      .mockResolvedValue(undefined);

    await service.createMessage({
      sessionId: 'session-1',
      name: 'Visitor',
      message: 'Help',
      images,
    });

    const createdMessage = repository.create.mock.calls[0]?.[0];
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(storage.put).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^contact\/[0-9a-f-]+\.jpg$/),
      Buffer.from('first-base64', 'base64'),
      'image/jpeg',
    );
    expect(createdMessage?.images).toHaveLength(2);
    expect(createdMessage?.images?.[0]?.mime).toBe('image/jpeg');
    expect(typeof createdMessage?.images?.[0]?.objectKey).toBe('string');
    expect(createdMessage?.images?.[1]?.mime).toBe('image/webp');
    expect(typeof createdMessage?.images?.[1]?.objectKey).toBe('string');
    expect(createdMessage.images?.[0]).not.toHaveProperty('data');
    expect(createdMessage.imageData).toBeNull();
    expect(createdMessage.imageMime).toBe('image/jpeg');
  });

  it('moves the legacy single-image input to private storage for new messages', async () => {
    const repository = {
      create: jest.fn((message: ContactMessage) => message),
      save: jest.fn((message: ContactMessage) => Promise.resolve(message)),
    };
    const storage = {
      put: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    } satisfies ObjectStorage;
    const service = new ContactService(
      repository as unknown as Repository<ContactMessage>,
      {} as unknown as MailService,
      { get: () => undefined } as unknown as ConfigService,
      storage,
    );
    jest
      .spyOn(notificationEmailService(service), 'sendNotificationEmail')
      .mockResolvedValue(undefined);

    await service.createMessage({
      sessionId: 'session-1',
      name: 'Visitor',
      message: 'Help',
      imageData: 'legacy-base64',
      imageMime: 'image/jpeg',
    });

    const createdMessage = repository.create.mock.calls[0]?.[0];
    expect(createdMessage?.images).toHaveLength(1);
    expect(createdMessage?.images?.[0]?.mime).toBe('image/jpeg');
    expect(typeof createdMessage?.images?.[0]?.objectKey).toBe('string');
    expect(createdMessage?.imageData).toBeNull();
    expect(createdMessage?.imageMime).toBe('image/jpeg');
  });

  it('removes files if saving the message fails', async () => {
    const repository = {
      create: jest.fn((message: ContactMessage) => message),
      save: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const storage = {
      put: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    } satisfies ObjectStorage;
    const service = new ContactService(
      repository as unknown as Repository<ContactMessage>,
      {} as unknown as MailService,
      { get: () => undefined } as unknown as ConfigService,
      storage,
    );

    await expect(
      service.createMessage({
        sessionId: 'session-1',
        name: 'Visitor',
        message: 'Help',
        images: [{ data: 'aGVsbG8=', mime: 'image/png' }],
      }),
    ).rejects.toThrow('database unavailable');
    expect(storage.delete).toHaveBeenCalledWith(
      expect.stringMatching(/^contact\/[0-9a-f-]+\.png$/),
    );
  });

  it('hydrates private files only in the admin detail service result and hides storage keys', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'message-1',
        images: [
          { objectKey: 'contact/image.jpg', mime: 'image/jpeg', width: 10 },
        ],
      }),
    };
    const storage = {
      put: jest.fn(),
      get: jest.fn().mockResolvedValue(Buffer.from('private image')),
      delete: jest.fn(),
    } satisfies ObjectStorage;
    const service = new ContactService(
      repository as unknown as Repository<ContactMessage>,
      {} as unknown as MailService,
      {} as unknown as ConfigService,
      storage,
    );

    await expect(service.getMessageById('message-1')).resolves.toEqual({
      id: 'message-1',
      images: [
        {
          mime: 'image/jpeg',
          width: 10,
          data: Buffer.from('private image').toString('base64'),
        },
      ],
    });
    expect(storage.get).toHaveBeenCalledWith('contact/image.jpg');
  });

  it('keeps legacy base64 image records readable without storage access', async () => {
    const image = { data: 'legacy-base64', mime: 'image/png' };
    const repository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'message-1', images: [image] }),
    };
    const storage = {
      put: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
    } satisfies ObjectStorage;
    const service = new ContactService(
      repository as unknown as Repository<ContactMessage>,
      {} as unknown as MailService,
      {} as unknown as ConfigService,
      storage,
    );

    await expect(service.getMessageById('message-1')).resolves.toEqual({
      id: 'message-1',
      images: [image],
    });
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('loads private contact files into notification email attachments', async () => {
    const imageBytes = Buffer.from('email image');
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const storage = {
      put: jest.fn(),
      get: jest.fn().mockResolvedValue(imageBytes),
      delete: jest.fn(),
    } satisfies ObjectStorage;
    const service = new ContactService(
      {} as unknown as Repository<ContactMessage>,
      { sendMail } as unknown as MailService,
      {
        get: (_key: string, fallback?: string) => fallback,
      } as unknown as ConfigService,
      storage,
    );

    await notificationEmailService(service).sendNotificationEmail({
      sessionId: 'session-1',
      name: 'Visitor',
      message: 'Help',
      images: [{ objectKey: 'contact/private.png', mime: 'image/png' }],
      createdAt: new Date('2026-10-23T00:00:00Z'),
    } as unknown as ContactMessage);

    expect(storage.get).toHaveBeenCalledWith('contact/private.png');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            content: imageBytes,
            contentType: 'image/png',
          }),
        ],
      }),
    );
  });

  it('retains files after database deletion so sequential backups can restore older DB snapshots', async () => {
    const storage = {
      put: jest.fn(),
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    } satisfies ObjectStorage;
    const repository = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const service = new ContactService(
      repository as unknown as Repository<ContactMessage>,
      {} as unknown as MailService,
      {} as unknown as ConfigService,
      storage,
    );

    await service.deleteMessage('message-1');
    expect(storage.delete).not.toHaveBeenCalled();

    repository.delete.mockRejectedValue(new Error('database unavailable'));
    await expect(service.deleteMessage('message-1')).rejects.toThrow(
      'database unavailable',
    );
    expect(storage.delete).not.toHaveBeenCalled();
  });
});

describe('ContactService admin message filters', () => {
  it('applies server pagination, status, search, and date filters', async () => {
    const query = {
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
    };
    const service = new ContactService(
      repository as unknown as Repository<ContactMessage>,
      {} as unknown as MailService,
      {} as unknown as ConfigService,
    );

    await service.getAllMessages(2, 25, {
      search: '  hello  ',
      status: 'unread',
      dateFrom: '2026-10-01T00:00:00.000Z',
      dateTo: '2026-11-01T00:00:00.000Z',
    });

    expect(query.andWhere).toHaveBeenCalledWith('message.isRead = :isRead', {
      isRead: false,
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('LOWER(message.name)'),
      { search: '%hello%' },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      'message.createdAt >= :dateFrom',
      { dateFrom: new Date('2026-10-01T00:00:00.000Z') },
    );
    expect(query.andWhere).toHaveBeenCalledWith('message.createdAt < :dateTo', {
      dateTo: new Date('2026-11-01T00:00:00.000Z'),
    });
    expect(query.skip).toHaveBeenCalledWith(25);
    expect(query.take).toHaveBeenCalledWith(25);
    expect(query.addOrderBy).toHaveBeenCalledWith('message.id', 'ASC');
    expect(query.getManyAndCount).toHaveBeenCalled();
  });

  it('includes the full date-only end day for contact message filters', async () => {
    const query = {
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
    };
    const service = new ContactService(
      repository as unknown as Repository<ContactMessage>,
      {} as unknown as MailService,
      {} as unknown as ConfigService,
    );

    await service.getAllMessages(1, 25, {
      dateFrom: '2026-10-31',
      dateTo: '2026-10-31',
    });

    expect(query.andWhere).toHaveBeenCalledWith(
      'message.createdAt >= :dateFrom',
      { dateFrom: new Date('2026-10-31T00:00:00.000Z') },
    );
    expect(query.andWhere).toHaveBeenCalledWith('message.createdAt < :dateTo', {
      dateTo: new Date('2026-11-01T00:00:00.000Z'),
    });
  });

  it('rejects an invalid date range before querying', async () => {
    const repository = { createQueryBuilder: jest.fn() };
    const service = new ContactService(
      repository as unknown as Repository<ContactMessage>,
      {} as unknown as MailService,
      {} as unknown as ConfigService,
    );

    await expect(
      service.getAllMessages(1, 25, { dateFrom: 'not-a-date' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createQueryBuilder).not.toHaveBeenCalled();
  });
});

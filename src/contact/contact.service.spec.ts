import { ContactService } from './contact.service';
import type { Repository } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import type { MailService } from '../mail/mail.service';
import type { ContactMessage } from './contact-message.entity';
import { BadRequestException } from '@nestjs/common';

describe('ContactService guest session token', () => {
  const service = new ContactService(
    {} as any,
    {} as any,
    { get: () => 'test-signing-secret-which-is-at-least-32-chars' } as any,
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
});

describe('ContactService contact image persistence', () => {
  it('stores multi-image uploads once in the images column', async () => {
    const images = [
      { data: 'first-base64', mime: 'image/jpeg' },
      { data: 'second-base64', mime: 'image/webp' },
    ];
    const repository = {
      create: jest.fn((message: ContactMessage) => message),
      save: jest.fn((message: ContactMessage) => Promise.resolve(message)),
    };
    const service = new ContactService(
      repository as unknown as Repository<ContactMessage>,
      {} as unknown as MailService,
      { get: () => undefined } as unknown as ConfigService,
    );
    jest
      .spyOn(service as any, 'sendNotificationEmail')
      .mockResolvedValue(undefined);

    await service.createMessage({
      sessionId: 'session-1',
      name: 'Visitor',
      message: 'Help',
      images,
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        images,
        imageData: null,
        imageMime: 'image/jpeg',
      }),
    );
  });

  it('keeps legacy single-image uploads in the legacy columns', async () => {
    const repository = {
      create: jest.fn((message: ContactMessage) => message),
      save: jest.fn((message: ContactMessage) => Promise.resolve(message)),
    };
    const service = new ContactService(
      repository as unknown as Repository<ContactMessage>,
      {} as unknown as MailService,
      { get: () => undefined } as unknown as ConfigService,
    );
    jest
      .spyOn(service as any, 'sendNotificationEmail')
      .mockResolvedValue(undefined);

    await service.createMessage({
      sessionId: 'session-1',
      name: 'Visitor',
      message: 'Help',
      imageData: 'legacy-base64',
      imageMime: 'image/jpeg',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        images: null,
        imageData: 'legacy-base64',
        imageMime: 'image/jpeg',
      }),
    );
  });
});

describe('ContactService admin message filters', () => {
  it('applies server pagination, status, search, and date filters', async () => {
    const query = {
      orderBy: jest.fn().mockReturnThis(),
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

    expect(query.andWhere).toHaveBeenCalledWith(
      'message.isRead = :isRead',
      { isRead: false },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('LOWER(message.name)'),
      { search: '%hello%' },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      'message.createdAt >= :dateFrom',
      { dateFrom: new Date('2026-10-01T00:00:00.000Z') },
    );
    expect(query.skip).toHaveBeenCalledWith(25);
    expect(query.take).toHaveBeenCalledWith(25);
    expect(query.getManyAndCount).toHaveBeenCalled();
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

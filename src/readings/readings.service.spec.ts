import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuditLog } from '../users/audit-log.entity';
import { Reading } from './reading.entity';
import {
  LEGACY_CLIENT_SALT,
  ReadingEncryptionService,
} from './reading-encryption';
import { ReadingsService } from './readings.service';
import { User } from '../users/user.entity';

describe('ReadingsService encryption at rest', () => {
  let service: ReadingsService;
  let encryption: ReadingEncryptionService;
  let repo: {
    create: jest.Mock;
    delete: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let auditRepo: { save: jest.Mock };
  let lastSaved: Reading | undefined;

  const userId = 'owner-1';
  const owner = Object.assign(new User(), { id: userId });
  const createdAt = new Date('2026-10-22T00:00:00.000Z');

  function encryptLegacyValue(value: unknown, accountId: string): string {
    const key = createHash('sha256')
      .update(`${accountId}:${LEGACY_CLIENT_SALT}`, 'utf8')
      .digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plaintext = typeof value === 'string' ? value : JSON.stringify(value);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return `enc_v1::${iv.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  beforeEach(() => {
    lastSaved = undefined;
    const key = Buffer.alloc(32, 7).toString('base64');
    const config = {
      get: (keyName: string) =>
        keyName === 'DATA_ENCRYPTION_KEYS'
          ? `test-key:${key}`
          : keyName === 'DATA_ENCRYPTION_ACTIVE_KEY_ID'
            ? 'test-key'
            : undefined,
    } as unknown as ConfigService;
    encryption = new ReadingEncryptionService(config);
    repo = {
      create: jest.fn((value: Partial<Reading>) => ({
        ...value,
        id: value.id ?? 'reading-1',
        createdAt,
      })),
      delete: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn((value: Reading) => {
        lastSaved = value;
        return value;
      }),
    };
    auditRepo = { save: jest.fn() };
    service = new ReadingsService(
      repo as unknown as Repository<Reading>,
      auditRepo as unknown as Repository<AuditLog>,
      encryption,
    );
  });

  it('stores only an envelope and safe metadata but returns the old API shape', async () => {
    const response = await service.createReading(userId, {
      app: 'iching',
      type: 'luc-hao',
      question: 'Private question',
      title: 'Private personal title',
      data: {
        result: { hexagram: 'Moon' },
        aiConversation: [{ text: 'Secret' }],
      },
    });

    const stored = getLastSaved();
    expect(stored.question).toBeNull();
    expect(stored.title).toBe('iching:luc-hao');
    expect(stored.data).toHaveProperty('_enc');
    expect(JSON.stringify(stored.data)).not.toContain('Private question');
    expect(JSON.stringify(stored.data)).not.toContain('Private personal title');
    expect(response).toMatchObject({
      question: 'Private question',
      title: 'Private personal title',
      data: { result: { hexagram: 'Moon' } },
    });
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { type: 'luc-hao' } }),
    );
  });

  it('stores a question over 500 characters only in the encrypted JSONB envelope', async () => {
    const longQuestion = 'Q'.repeat(501);

    const response = await service.createReading(userId, {
      app: 'iching',
      type: 'luc-hao',
      question: longQuestion,
      title: 'Private personal title',
      data: { result: { hexagram: 'Moon' } },
    });

    const stored = getLastSaved();
    expect(stored.question).toBeNull();
    expect(stored.title).toBe('iching:luc-hao');
    expect(stored.data).toHaveProperty('_enc');
    expect(JSON.stringify(stored.data)).not.toContain(longQuestion);
    expect(encryption.decryptEnvelope(stored.data, userId, stored.id)).toEqual({
      question: longQuestion,
      title: 'Private personal title',
      data: { result: { hexagram: 'Moon' } },
    });
    expect(response.question).toBe(longQuestion);
  });

  it('decrypts v2 rows on list and single-record reads, and leaves legacy rows intact', async () => {
    const encrypted = encryption.encryptPayload(
      { question: 'Question', title: 'Display title', data: { result: 42 } },
      userId,
      'reading-2',
    );
    const row = {
      id: 'reading-2',
      userId,
      user: owner,
      app: 'tarot',
      type: 'three-card',
      question: null,
      title: 'tarot:three-card',
      data: encrypted,
      createdAt,
    } as Reading;
    repo.find.mockResolvedValue([row]);
    repo.findOne.mockResolvedValue(row);

    await expect(service.getReadings(userId, 'tarot')).resolves.toMatchObject([
      { question: 'Question', title: 'Display title', data: { result: 42 } },
    ]);
    await expect(service.getReadingById(userId, row.id)).resolves.toMatchObject(
      {
        question: 'Question',
        title: 'Display title',
        data: { result: 42 },
      },
    );

    const legacy = {
      ...row,
      question: 'enc_v1::legacy-question',
      title: 'Legacy title',
      data: { aiConversation: 'enc_v1::legacy-conversation' },
    } as Reading;
    repo.findOne.mockResolvedValue(legacy);
    await expect(
      service.getReadingById(userId, legacy.id),
    ).resolves.toMatchObject({
      question: 'enc_v1::legacy-question',
      data: { aiConversation: 'enc_v1::legacy-conversation' },
    });
  });

  it('merges updates into decrypted data and encrypts the complete new payload', async () => {
    const encrypted = encryption.encryptPayload(
      {
        question: 'Question',
        title: 'Display title',
        data: { result: 42, aiConversation: [{ text: 'Old' }] },
      },
      userId,
      'reading-3',
    );
    const row = {
      id: 'reading-3',
      userId,
      user: owner,
      app: 'tuvi',
      type: 'tuvi-laso',
      question: null,
      title: 'tuvi:tuvi-laso',
      data: encrypted,
      createdAt,
    } as Reading;
    repo.findOne.mockResolvedValue(row);

    const response = await service.updateReadingData(userId, row.id, {
      aiConversation: [{ text: 'New' }],
    });
    const stored = getLastSaved();
    expect(stored.question).toBeNull();
    expect(stored.title).toBe('tuvi:tuvi-laso');
    expect(response).toMatchObject({
      question: 'Question',
      title: 'Display title',
      data: { result: 42, aiConversation: [{ text: 'New' }] },
    });
  });

  it('decrypts readable legacy fields before updating them to a V2 envelope', async () => {
    const row = {
      id: 'reading-legacy-readable',
      userId,
      user: owner,
      app: 'iching',
      type: 'luc-hao',
      question: encryptLegacyValue('Saved question', userId),
      title: encryptLegacyValue('Saved personal title', userId),
      data: {
        result: { hexagram: 'Moon' },
        aiConversation: encryptLegacyValue(
          { initialInterpretation: 'Old answer', followUps: [] },
          userId,
        ),
      },
      createdAt,
    } as Reading;
    repo.findOne.mockResolvedValue(row);

    const response = await service.updateReadingData(userId, row.id, {
      aiConversation: {
        initialInterpretation: 'Old answer',
        followUps: [{ question: 'Next', answer: 'New answer' }],
      },
    });

    const stored = getLastSaved();
    expect(stored.question).toBeNull();
    expect(stored.title).toBe('iching:luc-hao');
    expect(stored.data).toHaveProperty('_enc');
    expect(response).toMatchObject({
      question: 'Saved question',
      title: 'Saved personal title',
      data: {
        result: { hexagram: 'Moon' },
        aiConversation: {
          initialInterpretation: 'Old answer',
          followUps: [{ question: 'Next', answer: 'New answer' }],
        },
      },
    });
  });

  it('refuses to overwrite an envelope that fails authentication', async () => {
    repo.findOne.mockResolvedValue({
      id: 'reading-4',
      userId,
      app: 'iching',
      type: 'luc-hao',
      question: null,
      title: 'iching:luc-hao',
      data: { _enc: 'v2:test-key:invalid:invalid:invalid' },
      createdAt,
    });

    await expect(
      service.updateReadingData(userId, 'reading-4', { aiConversation: [] }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses to overwrite unreadable legacy client ciphertext', async () => {
    repo.findOne.mockResolvedValue({
      id: 'reading-5',
      userId,
      app: 'iching',
      type: 'luc-hao',
      question: null,
      title: 'iching:luc-hao',
      data: { aiConversation: 'enc_v1::invalid' },
      createdAt,
    });

    await expect(
      service.updateReadingData(userId, 'reading-5', {
        aiConversation: { followUps: [{ question: 'new', answer: 'new' }] },
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  function getLastSaved(): Reading {
    if (!lastSaved) throw new Error('No reading was saved');
    return lastSaved;
  }
});

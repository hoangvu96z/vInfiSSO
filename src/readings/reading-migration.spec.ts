import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { Reading } from './reading.entity';
import { LEGACY_CLIENT_SALT, ReadingEncryption } from './reading-encryption';
import {
  parseOptions,
  processBatch,
  runPass,
} from '../../scripts/encrypt-readings';

function makeLegacyValue(value: unknown, userId: string): string {
  const key = createHash('sha256')
    .update(`${userId}:${LEGACY_CLIENT_SALT}`, 'utf8')
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(
      typeof value === 'string' ? value : JSON.stringify(value),
      'utf8',
    ),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `enc_v1::${iv.toString('base64')}:${ciphertext.toString('base64')}`;
}

function makeReading(id: string, userId = 'user-a'): Reading {
  return {
    id,
    userId,
    app: 'iching',
    type: 'luc-hao',
    question: makeLegacyValue('Private question', userId),
    title: makeLegacyValue('Private title', userId),
    data: makeLegacyValue(
      { result: { value: 42 } },
      userId,
    ) as unknown as Record<string, unknown>,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    user: undefined as unknown as Reading['user'],
  };
}

function makeRepository(readings: Reading[]): {
  repository: Repository<Reading>;
  save: jest.Mock;
} {
  const queryBuilder = {
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(readings),
  };
  const save = jest.fn().mockResolvedValue(readings);
  const repository = {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    save,
  } as unknown as Repository<Reading>;
  return { repository, save };
}

describe('reading encryption migration failure handling', () => {
  const key = randomBytes(32).toString('base64');
  const encryption = new ReadingEncryption(`active:${key}`, 'active', true);

  function makeMixedReadings(): { valid: Reading; unreadable: Reading } {
    const valid = makeReading('reading-valid');
    const unreadable = makeReading('reading-unreadable');
    unreadable.question = makeLegacyValue('Private question', 'another-user');
    return { valid, unreadable };
  }

  it('counts unreadable records during dry-run without writing or mutating them', async () => {
    const { valid, unreadable } = makeMixedReadings();
    const unreadableBefore = structuredClone(unreadable);
    const { repository, save } = makeRepository([valid, unreadable]);

    const result = await processBatch(
      repository,
      null,
      parseOptions(['--dry-run']),
      encryption,
    );

    expect(result.eligible).toBe(1);
    expect(result.legacyDecryptionFailed).toBe(1);
    expect(save).not.toHaveBeenCalled();
    expect(unreadable).toEqual(unreadableBefore);
  });

  it('scans later batches after finding an unreadable row during dry-run', async () => {
    const validBefore = makeReading('reading-1');
    const unreadable = makeReading('reading-2');
    unreadable.question = makeLegacyValue('Private question', 'another-user');
    const validAfter = makeReading('reading-3');
    const unreadableBefore = structuredClone(unreadable);
    const readings = [validBefore, unreadable, validAfter];
    const save = jest.fn();
    const repository = {
      createQueryBuilder: jest.fn(() => {
        let cursor = '';
        let limit = readings.length;
        type Query = {
          orderBy: jest.Mock;
          take: jest.Mock;
          where: jest.Mock;
          setLock: jest.Mock;
          getMany: jest.Mock;
        };
        let query: Query;
        query = {
          orderBy: jest.fn().mockReturnThis(),
          take: jest.fn((value: number) => {
            limit = value;
            return query;
          }),
          where: jest.fn((_condition: string, params: { cursor: string }) => {
            cursor = params.cursor;
            return query;
          }),
          setLock: jest.fn().mockReturnThis(),
          getMany: jest.fn(async () =>
            readings.filter((reading) => reading.id > cursor).slice(0, limit),
          ),
        };
        return query;
      }),
      save,
    } as unknown as Repository<Reading>;

    const summary = await runPass(
      repository,
      parseOptions(['--dry-run', '--batch-size=1']),
      encryption,
      {} as Parameters<typeof runPass>[3],
    );

    expect(summary.scanned).toBe(3);
    expect(summary.legacyDecryptionFailed).toBe(1);
    expect(save).not.toHaveBeenCalled();
    expect(unreadable).toEqual(unreadableBefore);
  });

  it('migrates valid rows and leaves unreadable rows unchanged with explicit opt-in', async () => {
    const { valid, unreadable } = makeMixedReadings();
    const unreadableBefore = structuredClone(unreadable);
    const { repository, save } = makeRepository([valid, unreadable]);

    const result = await processBatch(
      repository,
      null,
      parseOptions(['--apply', '--skip-unreadable-legacy']),
      encryption,
    );

    expect(result.eligible).toBe(1);
    expect(result.legacyDecryptionFailed).toBe(1);
    expect(save).toHaveBeenCalledWith([valid]);
    expect(valid.question).toBeNull();
    expect(valid.title).toBe('iching:luc-hao');
    expect(encryption.decryptEnvelope(valid.data, valid.userId)).toEqual({
      question: 'Private question',
      title: 'Private title',
      data: { result: { value: 42 } },
    });
    expect(unreadable).toEqual(unreadableBefore);
  });

  it('fails closed by default when legacy decryption fails', async () => {
    const { valid, unreadable } = makeMixedReadings();
    const unreadableBefore = structuredClone(unreadable);
    const { repository, save } = makeRepository([valid, unreadable]);

    await expect(
      processBatch(repository, null, parseOptions(['--apply']), encryption),
    ).rejects.toThrow('Unreadable legacy reading record');

    expect(save).not.toHaveBeenCalled();
    expect(unreadable).toEqual(unreadableBefore);
  });

  it('keeps the skip option limited to apply mode', () => {
    expect(() =>
      parseOptions(['--dry-run', '--skip-unreadable-legacy']),
    ).toThrow('--skip-unreadable-legacy requires --apply');
  });

  it('keeps V2 decryption and key failures fatal even with legacy skip enabled', async () => {
    const wrongKey = randomBytes(32).toString('base64');
    const wrongEncryption = new ReadingEncryption(
      `wrong:${wrongKey}`,
      'wrong',
      true,
    );
    const reading = makeReading('reading-v2');
    reading.data = wrongEncryption.encryptPayload(
      { question: 'Q', title: 'T', data: { result: true } },
      reading.userId,
    );
    const { repository, save } = makeRepository([reading]);

    await expect(
      processBatch(
        repository,
        null,
        parseOptions(['--apply', '--skip-unreadable-legacy']),
        encryption,
      ),
    ).rejects.toThrow('Reading encryption key is unavailable');

    expect(save).not.toHaveBeenCalled();
  });
});

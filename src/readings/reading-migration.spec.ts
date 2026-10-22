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

function makeV2Envelope(
  value: unknown,
  userId: string,
  keyId: string,
  key: Buffer,
): { _enc: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`reading:${userId}`, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return {
    _enc: [
      'v2',
      keyId,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':'),
  };
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
  const keyBuffer = Buffer.from(key, 'base64');
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
    expect(
      encryption.decryptEnvelope(valid.data, valid.userId, valid.id),
    ).toEqual({
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

  it('accepts rollback dry-run by default and rejects conflicting modes', () => {
    expect(parseOptions(['--rollback-to-v2'])).toMatchObject({
      apply: false,
      rollbackToV2: true,
    });
    expect(() =>
      parseOptions(['--rollback-to-v2', '--apply', '--reencrypt']),
    ).toThrow('--rollback-to-v2 cannot be combined with --reencrypt');
    expect(() =>
      parseOptions([
        '--rollback-to-v2',
        '--apply',
        '--skip-unreadable-legacy',
      ]),
    ).toThrow(
      '--rollback-to-v2 cannot be combined with --skip-unreadable-legacy',
    );
  });

  it('migrates v2 records to row-bound v3 during the default apply pass', async () => {
    const reading = makeReading('reading-v2');
    const payload = {
      question: 'Question',
      title: 'Title',
      data: { result: { value: 7 } },
    };
    reading.question = null;
    reading.title = 'iching:luc-hao';
    reading.data = makeV2Envelope(payload, reading.userId, 'active', keyBuffer);
    const { repository, save } = makeRepository([reading]);

    const result = await processBatch(
      repository,
      null,
      parseOptions(['--apply']),
      encryption,
    );

    expect(result.eligible).toBe(1);
    expect(result.alreadyCurrent).toBe(0);
    expect(save).toHaveBeenCalledWith([reading]);
    expect(reading.data._enc).toMatch(/^v3:active:/);
    expect(
      encryption.decryptEnvelope(reading.data, reading.userId, reading.id),
    ).toEqual(payload);
  });

  it('counts v2 records for dry-run without saving them', async () => {
    const reading = makeReading('reading-v2-dry-run');
    reading.question = null;
    reading.title = 'iching:luc-hao';
    reading.data = makeV2Envelope(
      { question: 'Question', title: 'Title', data: { result: 7 } },
      reading.userId,
      'active',
      keyBuffer,
    );
    const { repository, save } = makeRepository([reading]);

    const result = await processBatch(
      repository,
      null,
      parseOptions(['--dry-run']),
      encryption,
    );

    expect(result.eligible).toBe(1);
    expect(result.alreadyCurrent).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps V2 decryption and key failures fatal even with legacy skip enabled', async () => {
    const wrongKey = randomBytes(32).toString('base64');
    const reading = makeReading('reading-v2');
    reading.question = null;
    reading.title = 'iching:luc-hao';
    reading.data = makeV2Envelope(
      { question: 'Q', title: 'T', data: { result: true } },
      reading.userId,
      'wrong',
      Buffer.from(wrongKey, 'base64'),
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

  it('dry-runs V3 to V2 rollback without mutating or saving rows', async () => {
    const reading = makeReading('reading-rollback-dry-run');
    const payload = {
      question: 'Question',
      title: 'Title',
      data: { result: { value: 9 } },
    };
    reading.question = null;
    reading.title = 'iching:luc-hao';
    reading.data = encryption.encryptPayload(
      payload,
      reading.userId,
      reading.id,
    );
    const before = structuredClone(reading);
    const { repository, save } = makeRepository([reading]);

    const result = await processBatch(
      repository,
      null,
      parseOptions(['--rollback-to-v2', '--dry-run']),
      encryption,
    );

    expect(result.eligible).toBe(1);
    expect(result.alreadyCurrent).toBe(0);
    expect(result.legacyPreserved).toBe(0);
    expect(save).not.toHaveBeenCalled();
    expect(reading).toEqual(before);
  });

  it('transactionally converts V3 rows to V2 for a lossless app rollback', async () => {
    const reading = makeReading('reading-rollback-apply');
    const payload = {
      question: 'Question',
      title: 'Title',
      data: { result: { value: 10 } },
    };
    reading.question = null;
    reading.title = 'iching:luc-hao';
    reading.data = encryption.encryptPayload(
      payload,
      reading.userId,
      reading.id,
    );
    const queryBuilder = {
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getMany: jest
        .fn()
        .mockResolvedValueOnce([reading])
        .mockResolvedValueOnce([]),
    };
    const save = jest.fn().mockResolvedValue(undefined);
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      save,
    } as unknown as Repository<Reading>;
    const dataSource = {
      transaction: jest.fn(
        async <T>(work: (manager: { getRepository: () => Repository<Reading> }) => Promise<T>) =>
          work({ getRepository: () => repository }),
      ),
    } as unknown as Parameters<typeof runPass>[3];

    const summary = await runPass(
      repository,
      parseOptions(['--rollback-to-v2', '--apply']),
      encryption,
      dataSource,
    );

    expect(summary.updated).toBe(1);
    expect(summary.eligible).toBe(1);
    expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    const savedRows = save.mock.calls[0][0] as Reading[];
    expect(savedRows[0].data._enc).toMatch(/^v2:active:/);
    expect(
      encryption.decryptEnvelope(
        savedRows[0].data,
        reading.userId,
        reading.id,
      ),
    ).toEqual(payload);
    expect(reading.data._enc).toMatch(/^v3:active:/);
  });

  it('preserves legacy client-encrypted rows during a V2 rollback', async () => {
    const reading = makeReading('reading-rollback-legacy');
    const before = structuredClone(reading);
    const { repository, save } = makeRepository([reading]);

    const result = await processBatch(
      repository,
      null,
      parseOptions(['--rollback-to-v2', '--dry-run']),
      encryption,
    );

    expect(result.eligible).toBe(0);
    expect(result.legacyPreserved).toBe(1);
    expect(save).not.toHaveBeenCalled();
    expect(reading).toEqual(before);
  });
});

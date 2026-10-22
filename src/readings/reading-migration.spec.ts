import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { Reading } from './reading.entity';
import { LEGACY_CLIENT_SALT, ReadingEncryption } from './reading-encryption';
import {
  applyWithExpectedUnreadableLegacyIds,
  loadExpectedUnreadableLegacyIds,
  parseOptions,
  processBatch,
  runPass,
  runValidatedDryRun,
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
  const save = jest.fn().mockResolvedValue(readings);
  const repository = {
    createQueryBuilder: jest.fn(() => {
      let cursor = '';
      let limit = readings.length;
      type MockQuery = {
        orderBy: jest.Mock;
        take: jest.Mock;
        where: jest.Mock;
        setLock: jest.Mock;
        getMany: jest.Mock;
      };
      const queryBuilder = {} as MockQuery;
      Object.assign(queryBuilder, {
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn((value: number) => {
          limit = value;
          return queryBuilder;
        }),
        where: jest.fn((_condition: string, params: { cursor: string }) => {
          cursor = params.cursor;
          return queryBuilder;
        }),
        setLock: jest.fn().mockReturnThis(),
        getMany: jest.fn(() =>
          readings
            .filter((reading) => reading.id > cursor)
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, limit)
            .map((reading) => structuredClone(reading)),
        ),
      });
      return queryBuilder;
    }),
    save,
  } as unknown as Repository<Reading>;
  return { repository, save };
}

function makeTransactionalDataSource(
  initialReadings: Reading[],
  onBatchRead?: (readCount: number, workingReadings: Reading[]) => void,
): {
  dataSource: DataSource;
  save: jest.Mock;
  getCommittedReadings: () => Reading[];
} {
  let committedReadings = structuredClone(initialReadings);
  let workingReadings: Reading[] = [];
  let batchReadCount = 0;
  const save = jest.fn((rows: Reading[]) => {
    for (const row of rows) {
      const index = workingReadings.findIndex((item) => item.id === row.id);
      if (index >= 0) workingReadings[index] = structuredClone(row);
    }
    return rows;
  });

  const makeTransactionRepository = (): Repository<Reading> => {
    const repository = {
      createQueryBuilder: jest.fn(() => {
        let cursor = '';
        let limit = initialReadings.length;
        type MockQuery = {
          orderBy: jest.Mock;
          take: jest.Mock;
          where: jest.Mock;
          setLock: jest.Mock;
          getMany: jest.Mock;
        };
        const query = {} as MockQuery;
        Object.assign(query, {
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
          getMany: jest.fn(() => {
            batchReadCount += 1;
            onBatchRead?.(batchReadCount, workingReadings);
            return workingReadings
              .filter((reading) => reading.id > cursor)
              .sort((a, b) => a.id.localeCompare(b.id))
              .slice(0, limit)
              .map((reading) => structuredClone(reading));
          }),
        });
        return query;
      }),
      save,
    };
    return repository as unknown as Repository<Reading>;
  };

  const dataSource = {
    transaction: jest.fn(
      async <T>(
        _isolationLevel: string,
        work: (manager: {
          getRepository: () => Repository<Reading>;
        }) => Promise<T>,
      ) => {
        workingReadings = structuredClone(committedReadings);
        const result = await work({ getRepository: makeTransactionRepository });
        committedReadings = structuredClone(workingReadings);
        return result;
      },
    ),
  } as unknown as DataSource;

  return {
    dataSource,
    save,
    getCommittedReadings: () => structuredClone(committedReadings),
  };
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
        const query = {} as Query;
        Object.assign(query, {
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
          getMany: jest.fn(() =>
            readings.filter((reading) => reading.id > cursor).slice(0, limit),
          ),
        });
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

  it('migrates valid rows and leaves only allowlisted unreadable rows unchanged', async () => {
    const { valid, unreadable } = makeMixedReadings();
    const unreadableBefore = structuredClone(unreadable);
    const { repository, save } = makeRepository([valid, unreadable]);
    const options = parseOptions([
      '--apply',
      '--expected-unreadable-legacy-ids-file=/private/reading-ids.txt',
    ]);
    options.expectedUnreadableLegacyIds = new Set([unreadable.id]);

    const result = await processBatch(repository, null, options, encryption);

    expect(result.eligible).toBe(1);
    expect(result.legacyDecryptionFailed).toBe(1);
    expect(result.legacyPreserved).toBe(1);
    expect(result.legacyDecryptionFailedIds).toEqual(new Set([unreadable.id]));
    expect(save).toHaveBeenCalledTimes(1);
    const savedBatches = save.mock.calls as unknown as Array<[Reading[]]>;
    const saved = savedBatches[0][0][0];
    expect(saved.id).toBe(valid.id);
    expect(saved.question).toBeNull();
    expect(saved.title).toBe('iching:luc-hao');
    expect(
      encryption.decryptEnvelope(saved.data, saved.userId, saved.id),
    ).toEqual({
      question: 'Private question',
      title: 'Private title',
      data: { result: { value: 42 } },
    });
    expect(valid.question).toMatch(/^enc_v1::/);
    expect(valid.title).toMatch(/^enc_v1::/);
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

  it('requires the exact-ID mode instead of the broad legacy skip flag', () => {
    expect(() => parseOptions(['--apply', '--skip-unreadable-legacy'])).toThrow(
      'Unknown migration option',
    );
    expect(
      parseOptions([
        '--dry-run',
        '--expected-unreadable-legacy-ids-file=/private/reading-ids.txt',
      ]),
    ).toMatchObject({
      apply: false,
      expectedUnreadableLegacyIdsFile: '/private/reading-ids.txt',
    });
    expect(() =>
      parseOptions([
        '--rollback-to-v2',
        '--expected-unreadable-legacy-ids-file=/private/reading-ids.txt',
      ]),
    ).toThrow(
      'Expected unreadable ID files cannot be used with --rollback-to-v2',
    );
  });

  it('loads expected unreadable IDs only from an owner-private regular file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'reading-id-allowlist-'));
    const filePath = join(directory, 'ids.txt');
    try {
      await writeFile(filePath, 'reading-a\nreading-b\n');
      await chmod(filePath, 0o600);
      expect(await loadExpectedUnreadableLegacyIds(filePath)).toEqual(
        new Set(['reading-a', 'reading-b']),
      );

      await chmod(filePath, 0o640);
      await expect(loadExpectedUnreadableLegacyIds(filePath)).rejects.toThrow(
        'Unable to read a valid private expected unreadable ID file',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preflights the exact unreadable ID set and commits allowlisted migration atomically', async () => {
    const readableFirst = makeReading('a-readable');
    const unreadable = makeReading('b-unreadable');
    unreadable.question = makeLegacyValue('Private question', 'wrong-owner');
    const unreadableBefore = structuredClone(unreadable);
    const readableLast = makeReading('c-readable');
    const { dataSource, save, getCommittedReadings } =
      makeTransactionalDataSource([readableFirst, unreadable, readableLast]);
    const options = parseOptions([
      '--apply',
      '--batch-size=1',
      '--expected-unreadable-legacy-ids-file=/private/reading-ids.txt',
    ]);
    options.expectedUnreadableLegacyIds = new Set([unreadable.id]);

    const result = await applyWithExpectedUnreadableLegacyIds(
      dataSource,
      options,
      encryption,
    );

    const transactionCalls = (dataSource.transaction as jest.Mock).mock.calls;
    expect(transactionCalls).toHaveLength(1);
    expect(transactionCalls[0]).toEqual(['SERIALIZABLE', expect.any(Function)]);
    expect(result).toMatchObject({
      scanned: 3,
      eligible: 2,
      updated: 2,
      legacyDecryptionFailed: 1,
      legacyPreserved: 1,
    });
    expect(result.legacyDecryptionFailedIds).toEqual(new Set([unreadable.id]));
    expect(save).toHaveBeenCalledTimes(2);

    const committed = getCommittedReadings();
    expect(committed[1]).toEqual(unreadableBefore);
    for (const reading of [committed[0], committed[2]]) {
      expect(reading.question).toBeNull();
      expect(reading.title).toBe('iching:luc-hao');
      expect(reading.data._enc).toMatch(/^v3:active:/);
      expect(
        encryption.decryptEnvelope(reading.data, reading.userId, reading.id),
      ).toMatchObject({ question: 'Private question', title: 'Private title' });
    }
  });

  it('accepts post-migration dry-run only when the unreadable set still matches the allowlist', async () => {
    const current = makeReading('a-current');
    const currentPayload = {
      question: 'Private question',
      title: 'Private title',
      data: { result: { value: 42 } },
    };
    current.question = null;
    current.title = 'iching:luc-hao';
    current.data = encryption.encryptPayload(
      currentPayload,
      current.userId,
      current.id,
    );
    const unreadable = makeReading('b-unreadable');
    unreadable.question = makeLegacyValue('Private question', 'wrong-owner');
    const before = structuredClone([current, unreadable]);
    const { repository, save } = makeRepository([current, unreadable]);
    const options = parseOptions([
      '--dry-run',
      '--expected-unreadable-legacy-ids-file=/private/reading-ids.txt',
    ]);
    options.expectedUnreadableLegacyIds = new Set([unreadable.id]);

    const result = await runValidatedDryRun(
      repository,
      options,
      encryption,
      {} as DataSource,
    );

    expect(result).toMatchObject({
      scanned: 2,
      eligible: 0,
      alreadyCurrent: 1,
      legacyDecryptionFailed: 1,
      legacyPreserved: 1,
    });
    expect(result.legacyDecryptionFailedIds).toEqual(new Set([unreadable.id]));
    expect(save).not.toHaveBeenCalled();
    expect([current, unreadable]).toEqual(before);

    options.expectedUnreadableLegacyIds = new Set(['a-current']);
    await expect(
      runValidatedDryRun(repository, options, encryption, {} as DataSource),
    ).rejects.toThrow(
      'Unreadable legacy reading set does not match the expected ID file',
    );
  });

  it.each([
    {
      name: 'an extra unreadable row',
      expectedIds: ['b-unreadable'],
      unreadableIds: ['b-unreadable', 'c-unreadable'],
    },
    {
      name: 'an allowlisted row that is no longer unreadable',
      expectedIds: ['a-readable', 'b-unreadable'],
      unreadableIds: ['b-unreadable'],
    },
  ])(
    'aborts before writing when the allowlist has $name',
    async ({ expectedIds, unreadableIds }) => {
      const readings = ['a-readable', 'b-unreadable', 'c-unreadable'].map(
        (id) => {
          const reading = makeReading(id);
          if (unreadableIds.includes(id)) {
            reading.question = makeLegacyValue(
              'Private question',
              'wrong-owner',
            );
          }
          return reading;
        },
      );
      const before = structuredClone(readings);
      const { dataSource, save, getCommittedReadings } =
        makeTransactionalDataSource(readings);
      const options = parseOptions([
        '--apply',
        '--expected-unreadable-legacy-ids-file=/private/reading-ids.txt',
      ]);
      options.expectedUnreadableLegacyIds = new Set(expectedIds);

      await expect(
        applyWithExpectedUnreadableLegacyIds(dataSource, options, encryption),
      ).rejects.toThrow(
        'Unreadable legacy reading set does not match the expected ID file',
      );

      expect(save).not.toHaveBeenCalled();
      expect(getCommittedReadings()).toEqual(before);
    },
  );

  it('rolls back staged batches when the unreadable set changes during apply', async () => {
    const readable = makeReading('a-readable');
    const expectedUnreadable = makeReading('b-expected-unreadable');
    expectedUnreadable.question = makeLegacyValue(
      'Private question',
      'wrong-owner',
    );
    const before = structuredClone([readable, expectedUnreadable]);
    const { dataSource, save, getCommittedReadings } =
      makeTransactionalDataSource(
        [readable, expectedUnreadable],
        (readCount, workingReadings) => {
          // With batch size 1, the first three reads complete preflight. On
          // the fifth read the first apply batch has been staged already.
          if (readCount === 5) {
            const row = workingReadings.find(
              (item) => item.id === expectedUnreadable.id,
            );
            if (row) {
              row.question = makeLegacyValue('Private question', row.userId);
            }
          }
        },
      );
    const options = parseOptions([
      '--apply',
      '--batch-size=1',
      '--expected-unreadable-legacy-ids-file=/private/reading-ids.txt',
    ]);
    options.expectedUnreadableLegacyIds = new Set([expectedUnreadable.id]);

    await expect(
      applyWithExpectedUnreadableLegacyIds(dataSource, options, encryption),
    ).rejects.toThrow(
      'Unreadable legacy reading set does not match the expected ID file',
    );

    expect(save).toHaveBeenCalledTimes(2);
    expect(getCommittedReadings()).toEqual(before);
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
        '--expected-unreadable-legacy-ids-file=/private/reading-ids.txt',
      ]),
    ).toThrow(
      'Expected unreadable ID files cannot be used with --rollback-to-v2',
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
    const original = structuredClone(reading);
    const { repository, save } = makeRepository([reading]);

    const result = await processBatch(
      repository,
      null,
      parseOptions(['--apply']),
      encryption,
    );

    expect(result.eligible).toBe(1);
    expect(result.alreadyCurrent).toBe(0);
    expect(save).toHaveBeenCalledTimes(1);
    const savedBatches = save.mock.calls as unknown as Array<[Reading[]]>;
    const saved = savedBatches[0][0][0];
    expect(saved.data._enc).toMatch(/^v3:active:/);
    expect(
      encryption.decryptEnvelope(saved.data, saved.userId, saved.id),
    ).toEqual(payload);
    expect(reading).toEqual(original);
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

  it('keeps V2 decryption and key failures fatal even with exact legacy exceptions enabled', async () => {
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
    const options = parseOptions([
      '--apply',
      '--expected-unreadable-legacy-ids-file=/private/reading-ids.txt',
    ]);
    options.expectedUnreadableLegacyIds = new Set([reading.id]);

    await expect(
      processBatch(repository, null, options, encryption),
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
        async <T>(
          work: (manager: {
            getRepository: () => Repository<Reading>;
          }) => Promise<T>,
        ) => work({ getRepository: () => repository }),
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
    const transactionCalls = (dataSource.transaction as jest.Mock).mock.calls;
    expect(transactionCalls).toHaveLength(2);
    const savedBatches = save.mock.calls as unknown as Array<[Reading[]]>;
    const savedRows = savedBatches[0][0];
    expect(savedRows[0].data._enc).toMatch(/^v2:active:/);
    expect(
      encryption.decryptEnvelope(savedRows[0].data, reading.userId, reading.id),
    ).toEqual(payload);
    expect(reading.data._enc).toMatch(/^v3:active:/);
  });

  it('preserves unreadable legacy client-encrypted rows during an applied V2 rollback', async () => {
    const reading = makeReading('reading-rollback-legacy');
    reading.question = makeLegacyValue('Private question', 'wrong-owner');
    const before = structuredClone(reading);
    const { repository, save } = makeRepository([reading]);

    const result = await processBatch(
      repository,
      null,
      parseOptions(['--rollback-to-v2', '--apply']),
      encryption,
    );

    expect(result.eligible).toBe(0);
    expect(result.legacyPreserved).toBe(1);
    expect(save).not.toHaveBeenCalled();
    expect(reading).toEqual(before);
  });
});

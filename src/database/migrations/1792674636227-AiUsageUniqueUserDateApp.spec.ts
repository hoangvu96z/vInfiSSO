import { AiUsageUniqueUserDateApp1792674636227 } from './1792674636227-AiUsageUniqueUserDateApp';
import type { QueryRunner } from 'typeorm';

describe('ai-usage unique-key migration', () => {
  it('fails before creating the index when duplicate keys exist', async () => {
    const queryRunner = {
      query: jest.fn().mockResolvedValue([{ has_duplicates: true }]),
    };
    const migration = new AiUsageUniqueUserDateApp1792674636227();

    await expect(
      migration.up(queryRunner as unknown as QueryRunner),
    ).rejects.toThrow(
      'duplicate (userId, date, app) rows exist. No rows were changed',
    );

    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.query.mock.calls[0][0]).toContain(
      'GROUP BY "userId", date, app',
    );
  });

  it('creates the unique index only after the duplicate preflight passes', async () => {
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ has_duplicates: false }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(undefined),
    };
    const migration = new AiUsageUniqueUserDateApp1792674636227();

    await migration.up(queryRunner as unknown as QueryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(3);
    expect(queryRunner.query.mock.calls[2][0]).toContain(
      'CREATE UNIQUE INDEX "IDX_72dc538b954157b0ed930f9f19"',
    );
    expect(queryRunner.query.mock.calls[2][0]).toContain(
      'ON public.ai_usage ("userId", date, app)',
    );
  });

  it('fails if the canonical index name is occupied by a different definition', async () => {
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ has_duplicates: false }])
        .mockResolvedValueOnce([
          {
            is_index: true,
            uses_btree: true,
            is_unique: false,
            is_valid: true,
            is_ready: true,
            has_no_predicate: true,
            has_no_expressions: true,
            has_expected_key_count: false,
            has_expected_columns: false,
            has_expected_table: true,
          },
        ]),
    };
    const migration = new AiUsageUniqueUserDateApp1792674636227();

    await expect(
      migration.up(queryRunner as unknown as QueryRunner),
    ).rejects.toThrow(
      'canonical name is already used by a different or invalid index',
    );

    expect(queryRunner.query).toHaveBeenCalledTimes(2);
  });

  it('accepts an existing valid index with the expected unique key', async () => {
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ has_duplicates: false }])
        .mockResolvedValueOnce([
          {
            is_index: true,
            uses_btree: true,
            is_unique: true,
            is_valid: true,
            is_ready: true,
            has_no_predicate: true,
            has_no_expressions: true,
            has_expected_key_count: true,
            has_expected_columns: true,
            has_expected_table: true,
          },
        ]),
    };
    const migration = new AiUsageUniqueUserDateApp1792674636227();

    await migration.up(queryRunner as unknown as QueryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(2);
  });

  it('refuses rollback that would remove quota uniqueness', async () => {
    const migration = new AiUsageUniqueUserDateApp1792674636227();

    await expect(migration.down({} as QueryRunner)).rejects.toThrow(
      'forward-only; removing the quota uniqueness constraint',
    );
  });
});

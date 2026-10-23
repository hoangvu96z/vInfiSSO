import type { QueryRunner } from 'typeorm';
import { UserStreaks1792886400000 } from '../database/migrations/1792886400000-UserStreaks';
import {
  applyOnlyStreakMigration,
  safeStreakMigrationDiagnostic,
  STREAK_MIGRATION_NAME,
} from '../../scripts/deploy-streak-migration';

describe('UserStreaks migration', () => {
  it('creates owner-scoped state and event tables with aggregate constraints', async () => {
    const sqlCalls: string[] = [];
    const query = jest.fn((sql: string) => {
      sqlCalls.push(sql);
      return Promise.resolve(undefined);
    });
    const migration = new UserStreaks1792886400000();

    await migration.up({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(4);
    expect(sqlCalls[0]).toContain('PRIMARY KEY (user_id, app_id)');
    expect(sqlCalls[0]).toContain('longest_streak >= current_streak');
    expect(sqlCalls[0]).toContain(
      "jsonb_typeof(daily_card_id) IN ('string', 'number')",
    );
    expect(sqlCalls[1]).toContain('PRIMARY KEY (user_id, app_id, event_id)');
    expect(sqlCalls[1]).toContain(
      'REFERENCES user_streaks(user_id, app_id) ON DELETE CASCADE',
    );
    expect(sqlCalls[2]).toContain('IDX_streak_activity_events_created');
    expect(sqlCalls[3]).toContain('GRANT SELECT, INSERT, UPDATE');
    expect(sqlCalls[3]).not.toMatch(/GRANT[^;]*DELETE/i);
  });

  it('is forward-only', async () => {
    await expect(new UserStreaks1792886400000().down()).rejects.toThrow(
      'forward-only',
    );
  });

  it('refuses unexpected pending migrations before opening a transaction', async () => {
    const executor = {
      getPendingMigrations: jest
        .fn()
        .mockResolvedValue([{ name: 'UnexpectedMigration', timestamp: 1 }]),
      getExecutedMigrations: jest.fn(),
      executeMigration: jest.fn(),
    };
    const queryRunner = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
    };

    await expect(
      applyOnlyStreakMigration(executor as never, queryRunner as never),
    ).rejects.toThrow('unexpected pending migration');
    expect(queryRunner.startTransaction).not.toHaveBeenCalled();
    expect(executor.executeMigration).not.toHaveBeenCalled();
  });

  it('suppresses SQL and parameter details in database failure logs', () => {
    const diagnostic = safeStreakMigrationDiagnostic({
      name: 'QueryFailedError',
      message: 'password=private-value and SQL with user reading data',
      driverError: {
        name: 'DatabaseError',
        code: '23505',
        detail: 'sensitive detail',
      },
    });

    expect(diagnostic).toEqual({
      name: 'DatabaseQueryError',
      code: '23505',
      category: 'database_query',
      message:
        'Database operation failed; query and parameter details suppressed.',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('private-value');
  });

  it('uses the planned migration identity', () => {
    expect(STREAK_MIGRATION_NAME).toBe('UserStreaks1792886400000');
  });
});

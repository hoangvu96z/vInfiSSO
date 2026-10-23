import type { QueryRunner } from 'typeorm';
import { UserStreaks1792886400000 } from '../database/migrations/1792886400000-UserStreaks';
import {
  applyOnlyStreakMigration,
  safeStreakMigrationDiagnostic,
  SEPAY_MIGRATION_NAME,
  STREAK_MIGRATION_NAME,
} from '../../scripts/deploy-streak-migration';

const validStateColumns = [
  ['user_id', 'uuid'],
  ['app_id', 'varchar'],
  ['current_streak', 'int4'],
  ['longest_streak', 'int4'],
  ['total_readings', 'int4'],
  ['last_active_date', 'date'],
  ['streak_freeze_used', 'bool'],
  ['daily_card_date', 'date'],
  ['daily_card_id', 'jsonb'],
  ['updated_at', 'timestamp'],
].map(([column_name, udt_name]) => ({ column_name, udt_name }));

const validActivityColumns = [
  ['user_id', 'uuid'],
  ['app_id', 'varchar'],
  ['event_id', 'uuid'],
  ['activity_date', 'date'],
  ['created_at', 'timestamp'],
].map(([column_name, udt_name]) => ({ column_name, udt_name }));

const validSePayColumns = [
  ['id', 'uuid'],
  ['provider', 'varchar'],
  ['provider_transaction_id', 'varchar'],
  ['payment_order_id', 'uuid'],
  ['transfer_type', 'varchar'],
  ['gateway', 'varchar'],
  ['reference', 'varchar'],
  ['amount', 'int8'],
  ['account_last4', 'varchar'],
  ['signature_timestamp', 'int8'],
  ['payload_sha256', 'varchar'],
  ['outcome', 'varchar'],
  ['rejection_reason', 'varchar'],
  ['received_at', 'timestamp'],
].map(([column_name, udt_name]) => ({ column_name, udt_name }));

const validConstraints = [
  ['user_streaks', 'pk_user_streaks', 'PRIMARY KEY (user_id, app_id)'],
  ['user_streaks', 'chk_user_streaks_counters', 'CHECK (current_streak >= 0)'],
  ['user_streaks', 'chk_user_streaks_app', "CHECK (app_id IN ('iching'))"],
  [
    'user_streaks',
    'chk_user_streaks_active_date',
    'CHECK (last_active_date IS NOT NULL)',
  ],
  [
    'user_streaks',
    'chk_user_streaks_daily_card',
    'CHECK (daily_card_id IS NULL)',
  ],
  [
    'streak_activity_events',
    'pk_streak_activity_events',
    'PRIMARY KEY (user_id, app_id, event_id)',
  ],
  [
    'streak_activity_events',
    'fk_streak_activity_events_streak',
    'FOREIGN KEY (user_id, app_id) REFERENCES user_streaks(user_id, app_id)',
  ],
  [
    'payment_webhook_events',
    'uq_payment_webhook_events_provider_transaction',
    'UNIQUE (provider, provider_transaction_id)',
  ],
  [
    'payment_webhook_events',
    'payment_webhook_events_order_fk',
    'FOREIGN KEY (payment_order_id) REFERENCES payment_orders(id) ON DELETE SET NULL',
  ],
  [
    'payment_webhook_events',
    'payment_webhook_events_amount_check',
    'CHECK ((amount > 0))',
  ],
  [
    'payment_webhook_events',
    'payment_webhook_events_account_check',
    "CHECK (((account_last4)::text ~ '^[A-Za-z0-9]{4}$'::text))",
  ],
  [
    'payment_webhook_events',
    'payment_webhook_events_payload_check',
    "CHECK (((payload_sha256)::text ~ '^[a-f0-9]{64}$'::text))",
  ],
  [
    'payment_webhook_events',
    'payment_webhook_events_outcome_check',
    "CHECK (outcome = ANY (ARRAY['received', 'paid', 'ignored']))",
  ],
].map(([table_name, name, definition]) => ({ table_name, name, definition }));

function createVerifiedSchemaQueryRunner() {
  return {
    query: jest.fn((sql: string) => {
      if (sql.includes("table_name = 'user_streaks'")) {
        return Promise.resolve(validStateColumns);
      }
      if (sql.includes("table_name = 'streak_activity_events'")) {
        return Promise.resolve(validActivityColumns);
      }
      if (sql.includes("table_name = 'payment_webhook_events'")) {
        return Promise.resolve(validSePayColumns);
      }
      if (sql.includes('FROM pg_constraint')) {
        return Promise.resolve(validConstraints);
      }
      if (sql.includes("tablename = 'streak_activity_events'")) {
        return Promise.resolve([
          { indexname: 'IDX_streak_activity_events_created' },
        ]);
      }
      if (sql.includes("tablename = 'payment_webhook_events'")) {
        return Promise.resolve([
          { indexname: 'IDX_payment_webhook_events_order_received' },
        ]);
      }
      return Promise.resolve([]);
    }),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
  };
}

function createMigrationExecutor(
  pendingNames: string[],
  executedNames: string[],
) {
  let nextId = 100;
  let pending = pendingNames.map((name) => ({ name, timestamp: nextId++ }));
  let executed = executedNames.map((name) => ({ name, id: nextId++ }));
  return {
    getPendingMigrations: jest.fn(() => Promise.resolve(pending)),
    getExecutedMigrations: jest.fn(() => Promise.resolve(executed)),
    executeMigration: jest.fn((migration: { name: string }) => {
      pending = pending.filter(({ name }) => name !== migration.name);
      const applied = { name: migration.name, id: nextId++ };
      executed = [...executed, applied];
      return Promise.resolve(migration);
    }),
  };
}

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

  it('allows SePay and refuses every unexpected pending migration before opening a transaction', async () => {
    const executor = {
      getPendingMigrations: jest.fn().mockResolvedValue([
        { name: SEPAY_MIGRATION_NAME, timestamp: 1 },
        { name: 'UnexpectedMigration', timestamp: 2 },
      ]),
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

  it('applies the pending SePay migration after the existing streak migration and verifies both schemas', async () => {
    const executor = createMigrationExecutor(
      [SEPAY_MIGRATION_NAME],
      [STREAK_MIGRATION_NAME],
    );
    const queryRunner = createVerifiedSchemaQueryRunner();

    await expect(
      applyOnlyStreakMigration(executor as never, queryRunner as never),
    ).resolves.toBe('applied');

    expect(executor.executeMigration).toHaveBeenCalledTimes(1);
    expect(executor.executeMigration).toHaveBeenCalledWith(
      expect.objectContaining({ name: SEPAY_MIGRATION_NAME }),
    );
    expect(queryRunner.startTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining("table_name = 'payment_webhook_events'"),
    );
  });

  it('applies only the known SePay and streak migrations when both are pending', async () => {
    const executor = createMigrationExecutor(
      [SEPAY_MIGRATION_NAME, STREAK_MIGRATION_NAME],
      [],
    );
    const queryRunner = createVerifiedSchemaQueryRunner();

    await expect(
      applyOnlyStreakMigration(executor as never, queryRunner as never),
    ).resolves.toBe('applied');

    expect(
      executor.executeMigration.mock.calls.map(([migration]) => migration.name),
    ).toEqual([SEPAY_MIGRATION_NAME, STREAK_MIGRATION_NAME]);
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
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

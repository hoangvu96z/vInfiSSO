import { MigrationExecutor, type QueryRunner } from 'typeorm';
import migrationDataSource from '../src/database/data-source';

export const STREAK_MIGRATION_NAME = 'UserStreaks1792886400000';
export const SEPAY_MIGRATION_NAME = 'SePayWebhookEvents1792800000000';

const BACKUP_GATED_MIGRATIONS = [
  SEPAY_MIGRATION_NAME,
  STREAK_MIGRATION_NAME,
] as const;

class StreakMigrationGateError extends Error {
  readonly code = 'STREAK_MIGRATION_GUARD';

  constructor(message: string) {
    super(message);
    this.name = 'StreakMigrationGateError';
  }
}

export type SafeStreakMigrationDiagnostic = {
  name: string;
  code?: string;
  category:
    'migration_guard' | 'database_connection' | 'database_query' | 'internal';
  message: string;
};

const CONNECTION_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

type MigrationExecutorLike = Pick<
  MigrationExecutor,
  'getPendingMigrations' | 'getExecutedMigrations' | 'executeMigration'
>;
type TransactionalQueryRunner = Pick<
  QueryRunner,
  'query' | 'startTransaction' | 'commitTransaction' | 'rollbackTransaction'
>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function isSafeErrorCode(value: string): boolean {
  return /^[0-9A-Z]{5}$/.test(value) || /^E[A-Z0-9_]{3,30}$/.test(value);
}

/** Logs only fixed diagnostics and allowlisted codes; driver messages may contain SQL or parameters. */
export function safeStreakMigrationDiagnostic(
  error: unknown,
): SafeStreakMigrationDiagnostic {
  if (error instanceof StreakMigrationGateError) {
    return {
      name: error.name,
      code: error.code,
      category: 'migration_guard',
      message: error.message,
    };
  }

  const root = asRecord(error);
  const driver = asRecord(root?.driverError);
  const rawCode = [root?.code, driver?.code].find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && isSafeErrorCode(candidate),
  );
  if (rawCode && CONNECTION_ERROR_CODES.has(rawCode)) {
    return {
      name: 'DatabaseConnectionError',
      code: rawCode,
      category: 'database_connection',
      message: 'Database connection failed; details suppressed.',
    };
  }

  const rootName = typeof root?.name === 'string' ? root.name : '';
  const driverName = typeof driver?.name === 'string' ? driver.name : '';
  const isQueryError =
    rootName === 'QueryFailedError' ||
    driverName === 'DatabaseError' ||
    (rawCode !== undefined && /^[0-9A-Z]{5}$/.test(rawCode));
  if (isQueryError) {
    return {
      name: 'DatabaseQueryError',
      ...(rawCode && /^[0-9A-Z]{5}$/.test(rawCode) ? { code: rawCode } : {}),
      category: 'database_query',
      message:
        'Database operation failed; query and parameter details suppressed.',
    };
  }

  return {
    name: 'MigrationRunnerError',
    category: 'internal',
    message: 'Streak migration runner failed; error details suppressed.',
  };
}

function requireOnlyBackupGatedMigrationsPending(names: string[]): void {
  const unexpected = names.filter(
    (name) =>
      !BACKUP_GATED_MIGRATIONS.includes(
        name as (typeof BACKUP_GATED_MIGRATIONS)[number],
      ),
  );
  if (unexpected.length) {
    throw new StreakMigrationGateError(
      `Refusing schema change: ${unexpected.length} unexpected pending migration(s).`,
    );
  }
  for (const allowedName of BACKUP_GATED_MIGRATIONS) {
    if (names.filter((name) => name === allowedName).length > 1) {
      throw new StreakMigrationGateError(
        'Refusing schema change: an expected migration is duplicated.',
      );
    }
  }
}

export async function verifyStreakSchema(
  queryRunner: Pick<QueryRunner, 'query'>,
): Promise<void> {
  const stateColumns = (await queryRunner.query(
    `SELECT column_name, udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_streaks'`,
  )) as Array<{ column_name: string; udt_name: string }>;
  const stateTypes = new Map(
    stateColumns.map(({ column_name, udt_name }) => [column_name, udt_name]),
  );
  const expectedStateColumns: Record<string, string> = {
    user_id: 'uuid',
    app_id: 'varchar',
    current_streak: 'int4',
    longest_streak: 'int4',
    total_readings: 'int4',
    last_active_date: 'date',
    streak_freeze_used: 'bool',
    daily_card_date: 'date',
    daily_card_id: 'jsonb',
    updated_at: 'timestamp',
  };
  for (const [name, type] of Object.entries(expectedStateColumns)) {
    if (stateTypes.get(name) !== type) {
      throw new StreakMigrationGateError(
        `Streak schema verification failed: user_streaks.${name} is missing or has the wrong type.`,
      );
    }
  }

  const eventColumns = (await queryRunner.query(
    `SELECT column_name, udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'streak_activity_events'`,
  )) as Array<{ column_name: string; udt_name: string }>;
  const eventTypes = new Map(
    eventColumns.map(({ column_name, udt_name }) => [column_name, udt_name]),
  );
  const expectedEventColumns: Record<string, string> = {
    user_id: 'uuid',
    app_id: 'varchar',
    event_id: 'uuid',
    activity_date: 'date',
    created_at: 'timestamp',
  };
  for (const [name, type] of Object.entries(expectedEventColumns)) {
    if (eventTypes.get(name) !== type) {
      throw new StreakMigrationGateError(
        `Streak schema verification failed: streak_activity_events.${name} is missing or has the wrong type.`,
      );
    }
  }

  const constraints = (await queryRunner.query(
    `SELECT conrelid::regclass::text AS table_name, conname AS name,
            pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conrelid IN (to_regclass('public.user_streaks'), to_regclass('public.streak_activity_events'))`,
  )) as Array<{ table_name: string; name: string; definition: string }>;
  const definitions = constraints.map(({ table_name, name, definition }) =>
    `${table_name} ${name} ${definition}`.toLowerCase(),
  );
  const requiredConstraints = [
    'user_streaks pk_user_streaks primary key (user_id, app_id)',
    'user_streaks chk_user_streaks_counters check',
    'user_streaks chk_user_streaks_app check',
    'user_streaks chk_user_streaks_active_date check',
    'user_streaks chk_user_streaks_daily_card check',
    'streak_activity_events pk_streak_activity_events primary key (user_id, app_id, event_id)',
    'streak_activity_events fk_streak_activity_events_streak foreign key (user_id, app_id)',
  ];
  for (const expected of requiredConstraints) {
    if (!definitions.some((value) => value.includes(expected))) {
      throw new StreakMigrationGateError(
        `Streak schema verification failed: required constraint is missing (${expected.split(' ').slice(1, 2)[0]}).`,
      );
    }
  }

  const indexes = (await queryRunner.query(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'streak_activity_events'`,
  )) as Array<{ indexname: string }>;
  if (
    !indexes.some(
      ({ indexname }) => indexname === 'IDX_streak_activity_events_created',
    )
  ) {
    throw new StreakMigrationGateError(
      'Streak schema verification failed: event retention index is missing.',
    );
  }
}

export async function verifySePayWebhookEventSchema(
  queryRunner: Pick<QueryRunner, 'query'>,
): Promise<void> {
  const columns = (await queryRunner.query(
    `SELECT column_name, udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'payment_webhook_events'`,
  )) as Array<{ column_name: string; udt_name: string }>;
  const types = new Map(
    columns.map(({ column_name, udt_name }) => [column_name, udt_name]),
  );
  const expectedColumns: Record<string, string> = {
    id: 'uuid',
    provider: 'varchar',
    provider_transaction_id: 'varchar',
    payment_order_id: 'uuid',
    transfer_type: 'varchar',
    gateway: 'varchar',
    reference: 'varchar',
    amount: 'int8',
    account_last4: 'varchar',
    signature_timestamp: 'int8',
    payload_sha256: 'varchar',
    outcome: 'varchar',
    rejection_reason: 'varchar',
    received_at: 'timestamp',
  };
  for (const [name, type] of Object.entries(expectedColumns)) {
    if (types.get(name) !== type) {
      throw new StreakMigrationGateError(
        `SePay schema verification failed: payment_webhook_events.${name} is missing or has the wrong type.`,
      );
    }
  }

  const constraints = (await queryRunner.query(
    `SELECT conrelid::regclass::text AS table_name, conname AS name,
            pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conrelid = to_regclass('public.payment_webhook_events')`,
  )) as Array<{ table_name: string; name: string; definition: string }>;
  const definitions = constraints.map(({ table_name, name, definition }) =>
    `${table_name} ${name} ${definition}`.toLowerCase().replaceAll('"', ''),
  );
  const requiredConstraints: Array<(definition: string) => boolean> = [
    (definition) =>
      definition.includes('unique (provider, provider_transaction_id)'),
    (definition) =>
      definition.includes('foreign key (payment_order_id)') &&
      definition.includes('references payment_orders(id)') &&
      definition.includes('on delete set null'),
    (definition) =>
      definition.includes('check') && definition.includes('amount > 0'),
    (definition) =>
      definition.includes('check') &&
      definition.includes('account_last4') &&
      definition.includes('~'),
    (definition) =>
      definition.includes('check') &&
      definition.includes('payload_sha256') &&
      definition.includes('~'),
    (definition) =>
      definition.includes('check') &&
      definition.includes('outcome') &&
      ['received', 'paid', 'ignored'].every((value) =>
        definition.includes(value),
      ),
  ];
  for (const matches of requiredConstraints) {
    if (!definitions.some(matches)) {
      throw new StreakMigrationGateError(
        'SePay schema verification failed: a required event constraint is missing.',
      );
    }
  }

  const indexes = (await queryRunner.query(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'payment_webhook_events'`,
  )) as Array<{ indexname: string }>;
  if (
    !indexes.some(
      ({ indexname }) =>
        indexname === 'IDX_payment_webhook_events_order_received',
    )
  ) {
    throw new StreakMigrationGateError(
      'SePay schema verification failed: event audit index is missing.',
    );
  }
}

export async function applyOnlyStreakMigration(
  executor: MigrationExecutorLike,
  queryRunner: TransactionalQueryRunner,
): Promise<'applied' | 'already_applied'> {
  const beforePending = await executor.getPendingMigrations();
  const pendingNames = beforePending.map(({ name }) => name);
  requireOnlyBackupGatedMigrationsPending(pendingNames);
  const beforeExecuted = await executor.getExecutedMigrations();
  const knownMigrationNames = new Set([
    ...pendingNames,
    ...beforeExecuted.map(({ name }) => name),
  ]);
  if (BACKUP_GATED_MIGRATIONS.some((name) => !knownMigrationNames.has(name))) {
    throw new StreakMigrationGateError(
      'Migration runner could not find every expected migration in its registry or history.',
    );
  }
  const targetWasExecuted = beforeExecuted.some(
    ({ name }) => name === STREAK_MIGRATION_NAME,
  );

  if (beforePending.length) {
    await queryRunner.startTransaction();
    try {
      const pending = await executor.getPendingMigrations();
      const transactionPendingNames = pending.map(({ name }) => name);
      requireOnlyBackupGatedMigrationsPending(transactionPendingNames);
      if (
        transactionPendingNames.length !== pendingNames.length ||
        transactionPendingNames.some((name) => !pendingNames.includes(name)) ||
        pendingNames.some((name) => !transactionPendingNames.includes(name))
      ) {
        throw new StreakMigrationGateError(
          'Refusing schema change: pending migrations changed before the transaction began.',
        );
      }
      for (const migration of pending) {
        const applied = await executor.executeMigration(migration);
        if (applied.name !== migration.name) {
          throw new StreakMigrationGateError(
            'Migration runner did not apply the expected backup-gated migration.',
          );
        }
      }
      await verifyMigrationHistory(executor, beforeExecuted, pendingNames);
      await verifyStreakSchema(queryRunner);
      await verifySePayWebhookEventSchema(queryRunner);
      await queryRunner.commitTransaction();
      return 'applied';
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    }
  }

  await verifyMigrationHistory(executor, beforeExecuted, []);
  await verifyStreakSchema(queryRunner);
  await verifySePayWebhookEventSchema(queryRunner);
  if (!targetWasExecuted) {
    throw new StreakMigrationGateError(
      'Streak migration verification failed: expected migration is not recorded.',
    );
  }
  return 'already_applied';
}

async function verifyMigrationHistory(
  executor: MigrationExecutorLike,
  beforeExecuted: Awaited<
    ReturnType<MigrationExecutor['getExecutedMigrations']>
  >,
  expectedNewlyExecuted: string[],
): Promise<void> {
  const pending = await executor.getPendingMigrations();
  requireOnlyBackupGatedMigrationsPending(pending.map(({ name }) => name));
  if (pending.length) {
    throw new StreakMigrationGateError(
      'Streak migration verification failed: a migration remains pending.',
    );
  }
  const afterExecuted = await executor.getExecutedMigrations();
  const added = afterExecuted.filter(
    ({ id }) => !beforeExecuted.some((before) => before.id === id),
  );
  const addedNames = added.map(({ name }) => name);
  if (
    addedNames.length !== expectedNewlyExecuted.length ||
    addedNames.some((name) => !expectedNewlyExecuted.includes(name)) ||
    expectedNewlyExecuted.some((name) => !addedNames.includes(name))
  ) {
    throw new StreakMigrationGateError(
      'Streak migration verification failed: migration history changed unexpectedly.',
    );
  }
  if (
    BACKUP_GATED_MIGRATIONS.some(
      (expectedName) =>
        !afterExecuted.some(({ name }) => name === expectedName),
    )
  ) {
    throw new StreakMigrationGateError(
      'Migration verification failed: an expected migration is not recorded.',
    );
  }
}

async function main(): Promise<void> {
  await migrationDataSource.initialize();
  const queryRunner = migrationDataSource.createQueryRunner();
  let locked = false;
  try {
    await queryRunner.connect();
    const lockResult = (await queryRunner.query(
      'SELECT pg_try_advisory_lock($1, $2) AS acquired',
      [1792886400, 640000],
    )) as Array<{ acquired: boolean }>;
    locked = lockResult[0]?.acquired === true;
    if (!locked) {
      throw new StreakMigrationGateError(
        'Refusing schema change: another streak migration runner holds the lock.',
      );
    }
    const executor = new MigrationExecutor(migrationDataSource, queryRunner);
    const result = await applyOnlyStreakMigration(executor, queryRunner);
    console.log(
      `Backup-gated SePay/streak migrations ${result}; both schemas verified.`,
    );
  } finally {
    if (locked) {
      await queryRunner.query(
        'SELECT pg_advisory_unlock($1, $2)',
        [1792886400, 640000],
      );
    }
    await queryRunner.release();
    await migrationDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const diagnostic = safeStreakMigrationDiagnostic(error);
    console.error(JSON.stringify(diagnostic));
    process.exitCode = 1;
  });
}

import { MigrationExecutor, type DataSource, type QueryRunner } from 'typeorm';
import migrationDataSource from '../src/database/data-source';

export const JOURNAL_MIGRATION_NAME = 'SpiritualJournal1792800000000';

class JournalMigrationGateError extends Error {
  readonly code = 'JOURNAL_MIGRATION_GUARD';

  constructor(message: string) {
    super(message);
    this.name = 'JournalMigrationGateError';
  }
}

export type SafeMigrationDiagnostic = {
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

/** Return only fixed diagnostics and allowlisted error codes; never include driver messages. */
export function safeMigrationDiagnostic(
  error: unknown,
): SafeMigrationDiagnostic {
  if (error instanceof JournalMigrationGateError) {
    return {
      name: 'JournalMigrationGateError',
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
    message: 'Migration runner failed; error details suppressed.',
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function isSafeErrorCode(value: string): boolean {
  return /^[0-9A-Z]{5}$/.test(value) || /^E[A-Z0-9_]{3,30}$/.test(value);
}

type MigrationExecutorLike = Pick<
  MigrationExecutor,
  'getPendingMigrations' | 'getExecutedMigrations' | 'executeMigration'
>;

type TransactionalQueryRunner = Pick<
  QueryRunner,
  'query' | 'startTransaction' | 'commitTransaction' | 'rollbackTransaction'
>;

function requireOnlyJournalPending(names: string[]): void {
  const unexpected = names.filter((name) => name !== JOURNAL_MIGRATION_NAME);
  if (unexpected.length) {
    throw new JournalMigrationGateError(
      `Refusing schema change: ${unexpected.length} unexpected pending migration(s).`,
    );
  }
  if (names.filter((name) => name === JOURNAL_MIGRATION_NAME).length > 1) {
    throw new JournalMigrationGateError(
      'Refusing schema change: Journal migration is duplicated.',
    );
  }
}

export async function verifySpiritualJournalSchema(
  queryRunner: Pick<QueryRunner, 'query'>,
): Promise<void> {
  const columns = (await queryRunner.query(
    `SELECT column_name, udt_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'journal_entries'`,
  )) as Array<{ column_name: string; udt_name: string }>;
  const columnTypes = new Map(
    columns.map(({ column_name, udt_name }) => [column_name, udt_name]),
  );
  const expectedColumns: Record<string, string> = {
    id: 'uuid',
    user_id: 'uuid',
    reading_id: 'uuid',
    encrypted_payload: 'jsonb',
    created_at: 'timestamp',
    updated_at: 'timestamp',
  };
  for (const [name, type] of Object.entries(expectedColumns)) {
    if (columnTypes.get(name) !== type) {
      throw new JournalMigrationGateError(
        `Journal schema verification failed: column ${name} is missing or has the wrong type.`,
      );
    }
  }

  const constraints = (await queryRunner.query(
    `SELECT conname AS name, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conrelid = to_regclass('public.journal_entries')`,
  )) as Array<{ name: string; definition: string }>;
  const definitions = constraints.map(({ name, definition }) =>
    `${name} ${definition}`.toLowerCase(),
  );
  if (
    !definitions.some(
      (value) =>
        value.includes('uq_journal_entries_reading') &&
        value.includes('unique (reading_id)'),
    )
  ) {
    throw new JournalMigrationGateError(
      'Journal schema verification failed: unique reading constraint is missing.',
    );
  }
  if (
    !definitions.some(
      (value) =>
        value.includes('chk_journal_entries_encrypted_payload') &&
        value.includes("encrypted_payload ? '_enc'"),
    )
  ) {
    throw new JournalMigrationGateError(
      'Journal schema verification failed: encrypted payload constraint is missing.',
    );
  }
  if (
    !definitions.some(
      (value) =>
        value.includes('foreign key (user_id)') &&
        value.includes('references users(id)') &&
        value.includes('on delete cascade'),
    )
  ) {
    throw new JournalMigrationGateError(
      'Journal schema verification failed: user ownership foreign key is missing.',
    );
  }
  if (
    !definitions.some(
      (value) =>
        value.includes('foreign key (reading_id)') &&
        value.includes('references readings(id)') &&
        value.includes('on delete cascade'),
    )
  ) {
    throw new JournalMigrationGateError(
      'Journal schema verification failed: reading link foreign key is missing.',
    );
  }

  const indexes = (await queryRunner.query(
    `SELECT indexname
       FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'journal_entries'`,
  )) as Array<{ indexname: string }>;
  if (
    !indexes.some(
      ({ indexname }) => indexname === 'IDX_journal_entries_user_created',
    )
  ) {
    throw new JournalMigrationGateError(
      'Journal schema verification failed: user/date index is missing.',
    );
  }
}

export async function applyOnlySpiritualJournalMigration(
  executor: MigrationExecutorLike,
  queryRunner: TransactionalQueryRunner,
): Promise<'applied' | 'already_applied'> {
  const beforePending = await executor.getPendingMigrations();
  requireOnlyJournalPending(beforePending.map(({ name }) => name));
  if (beforePending.length > 1) {
    throw new JournalMigrationGateError(
      'Refusing schema change: more than one migration is pending.',
    );
  }
  const beforeExecuted = await executor.getExecutedMigrations();
  const targetWasExecuted = beforeExecuted.some(
    ({ name }) => name === JOURNAL_MIGRATION_NAME,
  );

  let result: 'applied' | 'already_applied' = 'already_applied';
  if (beforePending.length) {
    await queryRunner.startTransaction();
    try {
      // Recheck inside the transaction, then pass only the Journal migration
      // object to TypeORM. executePendingMigrations() would rescan and could
      // apply another migration introduced after the initial guard.
      const transactionPending = await executor.getPendingMigrations();
      requireOnlyJournalPending(transactionPending.map(({ name }) => name));
      if (
        transactionPending.length !== 1 ||
        transactionPending[0].name !== JOURNAL_MIGRATION_NAME
      ) {
        throw new JournalMigrationGateError(
          'Refusing schema change: the Journal migration is no longer the only pending migration.',
        );
      }

      const applied = await executor.executeMigration(transactionPending[0]);
      if (applied.name !== JOURNAL_MIGRATION_NAME) {
        throw new JournalMigrationGateError(
          'Migration runner did not apply the expected Journal migration.',
        );
      }
      result = 'applied';

      await verifyMigrationHistory(executor, beforeExecuted, false);
      await verifySpiritualJournalSchema(queryRunner);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    }
  }

  await verifyMigrationHistory(executor, beforeExecuted, targetWasExecuted);
  await verifySpiritualJournalSchema(queryRunner);
  return result;
}

async function verifyMigrationHistory(
  executor: MigrationExecutorLike,
  beforeExecuted: Awaited<
    ReturnType<MigrationExecutor['getExecutedMigrations']>
  >,
  targetWasExecuted: boolean,
): Promise<void> {
  const afterPending = await executor.getPendingMigrations();
  requireOnlyJournalPending(afterPending.map(({ name }) => name));
  if (afterPending.length) {
    throw new JournalMigrationGateError(
      'Migration verification failed: a migration is still pending.',
    );
  }
  const afterExecuted = await executor.getExecutedMigrations();
  if (!afterExecuted.some(({ name }) => name === JOURNAL_MIGRATION_NAME)) {
    throw new JournalMigrationGateError(
      'Migration verification failed: Journal migration is absent from migration history.',
    );
  }
  const newlyExecuted = afterExecuted
    .filter(
      ({ name }) => !beforeExecuted.some((previous) => previous.name === name),
    )
    .map(({ name }) => name);
  const expectedNewlyExecuted = targetWasExecuted
    ? []
    : [JOURNAL_MIGRATION_NAME];
  if (
    newlyExecuted.length !== expectedNewlyExecuted.length ||
    newlyExecuted.some((name) => !expectedNewlyExecuted.includes(name))
  ) {
    throw new JournalMigrationGateError(
      'Migration verification failed: unexpected migration history changes were detected.',
    );
  }
}

function requireExplicitDatabaseTarget(dataSource: DataSource): void {
  const environment = process.env;
  const requiredSettings = [
    environment.MIGRATION_DATABASE_HOST || environment.DATABASE_HOST,
    environment.MIGRATION_DATABASE_USER || environment.DATABASE_USER,
    environment.MIGRATION_DATABASE_NAME || environment.DATABASE_NAME,
  ];
  if (requiredSettings.some((value) => !value?.trim())) {
    throw new JournalMigrationGateError(
      'Migration database target is not fully configured; refusing default connection settings.',
    );
  }
  if (dataSource.options.type !== 'postgres') {
    throw new JournalMigrationGateError(
      'Migration runner requires the configured PostgreSQL DataSource.',
    );
  }
}

async function main(): Promise<void> {
  requireExplicitDatabaseTarget(migrationDataSource);
  await migrationDataSource.initialize();
  const queryRunner = migrationDataSource.createQueryRunner();
  let lockAcquired = false;
  let queryRunnerConnected = false;
  try {
    await queryRunner.connect();
    queryRunnerConnected = true;
    await queryRunner.query(
      'SELECT pg_advisory_lock($1, $2)',
      [17171717, 1792800000],
    );
    lockAcquired = true;
    const executor = new MigrationExecutor(migrationDataSource, queryRunner);
    const result = await applyOnlySpiritualJournalMigration(
      executor,
      queryRunner,
    );
    console.log(
      `Journal migration ${result}; migration history and journal schema verified.`,
    );
  } finally {
    try {
      if (lockAcquired) {
        await queryRunner.query(
          'SELECT pg_advisory_unlock($1, $2)',
          [17171717, 1792800000],
        );
      }
    } finally {
      try {
        if (queryRunnerConnected) await queryRunner.release();
      } finally {
        await migrationDataSource.destroy();
      }
    }
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `[journal-migration] ${JSON.stringify(safeMigrationDiagnostic(error))}`,
    );
    process.exitCode = 1;
  });
}

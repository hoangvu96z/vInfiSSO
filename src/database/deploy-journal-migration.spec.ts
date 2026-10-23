import {
  applyOnlySpiritualJournalMigration,
  JOURNAL_MIGRATION_NAME,
  safeMigrationDiagnostic,
  verifySpiritualJournalSchema,
} from '../../scripts/deploy-journal-migration';

const journalMigration = {
  name: JOURNAL_MIGRATION_NAME,
  timestamp: 1792800000000,
  instance: { up: jest.fn() },
};

function createSchemaRunner(
  overrides: {
    columns?: unknown[];
    constraints?: unknown[];
    indexes?: unknown[];
  } = {},
) {
  const query = jest.fn<Promise<unknown[]>, [string, unknown[]?]>(
    (sql: string) => {
      if (sql.includes('information_schema.columns')) {
        return Promise.resolve(
          overrides.columns ?? [
            { column_name: 'id', udt_name: 'uuid' },
            { column_name: 'user_id', udt_name: 'uuid' },
            { column_name: 'reading_id', udt_name: 'uuid' },
            { column_name: 'encrypted_payload', udt_name: 'jsonb' },
            { column_name: 'created_at', udt_name: 'timestamp' },
            { column_name: 'updated_at', udt_name: 'timestamp' },
          ],
        );
      }
      if (sql.includes('FROM pg_constraint')) {
        return Promise.resolve(
          overrides.constraints ?? [
            {
              name: 'UQ_journal_entries_reading',
              definition: 'UNIQUE (reading_id)',
            },
            {
              name: 'CHK_journal_entries_encrypted_payload',
              definition:
                "CHECK (((jsonb_typeof(encrypted_payload) = 'object') AND (encrypted_payload ? '_enc')))",
            },
            {
              name: 'journal_entries_user_id_fkey',
              definition:
                'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
            },
            {
              name: 'journal_entries_reading_id_fkey',
              definition:
                'FOREIGN KEY (reading_id) REFERENCES readings(id) ON DELETE CASCADE',
            },
          ],
        );
      }
      if (sql.includes('FROM pg_indexes')) {
        return Promise.resolve(
          overrides.indexes ?? [
            { indexname: 'IDX_journal_entries_user_created' },
          ],
        );
      }
      throw new Error(`Unexpected schema query: ${sql}`);
    },
  );
  return {
    query,
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
  };
}

describe('Spiritual Journal deployment migration gate', () => {
  it('refuses to proceed if any other migration is pending', async () => {
    const otherMigration = {
      ...journalMigration,
      name: 'AnotherMigration1792900000000',
    };
    const executor = {
      getPendingMigrations: jest.fn().mockResolvedValue([otherMigration]),
      getExecutedMigrations: jest.fn(),
      executeMigration: jest.fn(),
    };
    const runner = createSchemaRunner();

    await expect(
      applyOnlySpiritualJournalMigration(executor as never, runner as never),
    ).rejects.toThrow('unexpected pending migration');
    expect(executor.executeMigration).not.toHaveBeenCalled();
    expect(runner.startTransaction).not.toHaveBeenCalled();
  });

  it('rechecks the pending set inside the transaction before applying', async () => {
    const otherMigration = {
      ...journalMigration,
      name: 'AnotherMigration1792900000000',
    };
    const executor = {
      getPendingMigrations: jest
        .fn()
        .mockResolvedValueOnce([journalMigration])
        .mockResolvedValueOnce([journalMigration, otherMigration]),
      getExecutedMigrations: jest.fn().mockResolvedValue([]),
      executeMigration: jest.fn(),
    };
    const runner = createSchemaRunner();

    await expect(
      applyOnlySpiritualJournalMigration(executor as never, runner as never),
    ).rejects.toThrow('unexpected pending migration');
    expect(runner.startTransaction).toHaveBeenCalledTimes(1);
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(executor.executeMigration).not.toHaveBeenCalled();
  });

  it('executes only the Journal migration transactionally and verifies history/schema', async () => {
    const executor = {
      getPendingMigrations: jest
        .fn()
        .mockResolvedValueOnce([journalMigration])
        .mockResolvedValueOnce([journalMigration])
        .mockResolvedValueOnce([]),
      getExecutedMigrations: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([journalMigration]),
      executeMigration: jest.fn().mockResolvedValue(journalMigration),
    };
    const runner = createSchemaRunner();

    await expect(
      applyOnlySpiritualJournalMigration(executor as never, runner as never),
    ).resolves.toBe('applied');
    expect(executor.executeMigration).toHaveBeenCalledTimes(1);
    expect(executor.executeMigration).toHaveBeenCalledWith(journalMigration);
    expect(runner.startTransaction).toHaveBeenCalledTimes(1);
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
    expect(runner.query).toHaveBeenCalledTimes(3);
  });

  it('verifies an already-applied migration without opening a transaction', async () => {
    const executor = {
      getPendingMigrations: jest.fn().mockResolvedValue([]),
      getExecutedMigrations: jest.fn().mockResolvedValue([journalMigration]),
      executeMigration: jest.fn(),
    };
    const runner = createSchemaRunner();

    await expect(
      applyOnlySpiritualJournalMigration(executor as never, runner as never),
    ).resolves.toBe('already_applied');
    expect(executor.executeMigration).not.toHaveBeenCalled();
    expect(runner.startTransaction).not.toHaveBeenCalled();
  });

  it('rolls back if post-migration schema verification fails', async () => {
    const executor = {
      getPendingMigrations: jest
        .fn()
        .mockResolvedValueOnce([journalMigration])
        .mockResolvedValueOnce([journalMigration])
        .mockResolvedValueOnce([]),
      getExecutedMigrations: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([journalMigration]),
      executeMigration: jest.fn().mockResolvedValue(journalMigration),
    };
    const runner = createSchemaRunner({ indexes: [] });

    await expect(
      applyOnlySpiritualJournalMigration(executor as never, runner as never),
    ).rejects.toThrow('user/date index is missing');
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.commitTransaction).not.toHaveBeenCalled();
  });

  it('rejects an incomplete Journal table', async () => {
    const runner = createSchemaRunner({ columns: [] });
    await expect(verifySpiritualJournalSchema(runner as never)).rejects.toThrow(
      'column id is missing or has the wrong type',
    );
  });

  it('keeps safe connection diagnostics and suppresses credentials and parameters', () => {
    const connection = Object.assign(
      new Error(
        'DATABASE_PASSWORD=db-secret postgres://db-user:url-secret@db.internal/vinfi_sso parameters=["param-secret"]',
      ),
      { code: 'ETIMEDOUT' },
    );

    const diagnostic = safeMigrationDiagnostic(connection);
    const serialized = JSON.stringify(diagnostic);

    expect(diagnostic).toEqual({
      name: 'DatabaseConnectionError',
      code: 'ETIMEDOUT',
      category: 'database_connection',
      message: 'Database connection failed; details suppressed.',
    });
    for (const secret of [
      'db-secret',
      'db-user',
      'url-secret',
      'db.internal',
      'param-secret',
      'DATABASE_PASSWORD',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('keeps the SQLSTATE while suppressing database query text and parameters', () => {
    const queryError = Object.assign(
      new Error(
        'password=sql-secret postgres://query-user:query-secret@db.internal/vinfi_sso',
      ),
      {
        name: 'QueryFailedError',
        query: 'INSERT INTO journal_entries VALUES ($1)',
        parameters: ['payload-secret'],
        driverError: {
          name: 'DatabaseError',
          code: '23505',
          message: 'duplicate value payload-secret',
        },
      },
    );

    const diagnostic = safeMigrationDiagnostic(queryError);
    const serialized = JSON.stringify(diagnostic);

    expect(diagnostic).toEqual({
      name: 'DatabaseQueryError',
      code: '23505',
      category: 'database_query',
      message:
        'Database operation failed; query and parameter details suppressed.',
    });
    for (const secret of [
      'sql-secret',
      'query-user',
      'query-secret',
      'db.internal',
      'payload-secret',
      'INSERT INTO',
      'journal_entries',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

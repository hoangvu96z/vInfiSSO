import { DataSource } from 'typeorm';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Reading } from '../src/readings/reading.entity';
import { OAuthAccount } from '../src/users/oauth-account.entity';
import { Session } from '../src/users/session.entity';
import { User } from '../src/users/user.entity';
import { ReadingEncryption } from '../src/readings/reading-encryption';
import {
  assertPrivateRecoverySocketDirectory,
  assertLocalRecoveryDatabaseUrl,
  assertRecoveryServerIdentity,
  containsLegacyClientCiphertext,
  createEncryptedRecoveryArtifactRecord,
  createRecoveryArtifact,
  readProtectedLegacyKeyFile,
  writeRecoveryArtifactFile,
} from '../src/readings/offline-legacy-reading-recovery';

interface RecoveryOptions {
  keyFile: string;
  outputFile: string;
  userId: string;
}

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseRecoveryOptions(args: string[]): RecoveryOptions {
  const values = new Map<string, string>();
  for (const arg of args) {
    const separator = arg.indexOf('=');
    if (separator < 3 || !arg.startsWith('--')) {
      throw new Error('Invalid recovery option');
    }
    const name = arg.slice(2, separator);
    const value = arg.slice(separator + 1).trim();
    if (
      !['key-file', 'output-file', 'user-id'].includes(name) ||
      !value ||
      values.has(name)
    ) {
      throw new Error('Invalid recovery option');
    }
    values.set(name, value);
  }

  const keyFile = values.get('key-file');
  const outputFile = values.get('output-file');
  const userId = values.get('user-id');
  if (
    !keyFile ||
    !outputFile ||
    !userId ||
    !USER_ID_PATTERN.test(userId) ||
    ![keyFile, outputFile].every((filePath) => filePath.startsWith('/')) ||
    resolve(keyFile) === resolve(outputFile)
  ) {
    throw new Error('A key file, output file, and valid user ID are required');
  }
  return { keyFile, outputFile, userId };
}

function createReadOnlyDataSource(
  databaseUrl: string,
  socketDirectory?: string,
): DataSource {
  const parsed = new URL(databaseUrl);
  return new DataSource({
    type: 'postgres',
    host: socketDirectory || parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)),
    entities: [Reading, User, OAuthAccount, Session],
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: { options: '-c default_transaction_read_only=on' },
  });
}

async function assertOutputDoesNotExist(filePath: string): Promise<void> {
  try {
    await access(filePath, constants.F_OK);
    throw new Error('Recovery output already exists');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('Recovery output must be a new local file');
    }
  }
}

async function recover(options: RecoveryOptions): Promise<void> {
  const databaseUrl = process.env.RECOVERY_DATABASE_URL;
  const databaseName = databaseUrl
    ? assertLocalRecoveryDatabaseUrl(databaseUrl)
    : null;
  const socketDirectory = process.env.RECOVERY_DATABASE_SOCKET_DIR?.trim();
  if (socketDirectory) {
    await assertPrivateRecoverySocketDirectory(socketDirectory);
  }
  const encryption = new ReadingEncryption(
    process.env.DATA_ENCRYPTION_KEYS,
    process.env.DATA_ENCRYPTION_ACTIVE_KEY_ID,
    true,
  );
  if (resolve(options.keyFile) === resolve(options.outputFile)) {
    throw new Error('Recovery output must be separate from its inputs');
  }
  await assertOutputDoesNotExist(options.outputFile);
  const legacyKey = await readProtectedLegacyKeyFile(options.keyFile);

  const dataSource = createReadOnlyDataSource(databaseUrl!, socketDirectory);
  let queryRunner;
  let artifactRecords: ReturnType<typeof createEncryptedRecoveryArtifactRecord>[] = [];
  let scanned = 0;
  let candidates = 0;
  let failed = 0;

  try {
    await dataSource.initialize();
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('REPEATABLE READ');
    await queryRunner.query('SET TRANSACTION READ ONLY');

    const [identity] = await queryRunner.query(
      'SELECT current_database() AS database_name, inet_server_addr()::text AS server_address',
    );
    assertRecoveryServerIdentity(
      identity?.database_name,
      identity?.server_address,
      !!socketDirectory,
    );
    if (identity.database_name !== databaseName) {
      throw new Error('Connected database does not match the recovery URL');
    }

    const rows = await queryRunner.manager.getRepository(Reading).find({
      where: { userId: options.userId },
      order: { id: 'ASC' },
    });
    scanned = rows.length;
    for (const reading of rows) {
      if (
        !containsLegacyClientCiphertext(reading.question) &&
        !containsLegacyClientCiphertext(reading.title) &&
        !containsLegacyClientCiphertext(reading.data)
      ) {
        continue;
      }
      candidates += 1;
      try {
        artifactRecords.push(
          createEncryptedRecoveryArtifactRecord(
            reading,
            legacyKey,
            encryption,
          ),
        );
      } catch {
        failed += 1;
      }
    }
    await queryRunner.rollbackTransaction();
  } finally {
    if (queryRunner?.isTransactionActive) {
      await queryRunner.rollbackTransaction().catch(() => undefined);
    }
    await queryRunner?.release().catch(() => undefined);
    await dataSource.destroy().catch(() => undefined);
    legacyKey.fill(0);
  }

  if (failed > 0) {
    throw new Error(
      `Recovery stopped: ${failed} of ${candidates} legacy rows could not be authenticated; no artifact was written`,
    );
  }
  if (candidates === 0) {
    throw new Error('No legacy encrypted readings were found for this user');
  }

  const artifact = createRecoveryArtifact(databaseName!, artifactRecords);
  await writeRecoveryArtifactFile(options.outputFile, artifact);
  console.log(
    JSON.stringify({
      mode: 'read-only-recovery-artifact',
      database: databaseName,
      scanned,
      candidates,
      recovered: artifactRecords.length,
      databaseUpdated: false,
      outputCreated: true,
    }),
  );
}

async function main(): Promise<void> {
  let options: RecoveryOptions;
  try {
    options = parseRecoveryOptions(process.argv.slice(2));
    if (!process.env.RECOVERY_DATABASE_URL) {
      throw new Error('RECOVERY_DATABASE_URL is required');
    }
    await recover(options);
  } catch (error) {
    const message =
      error instanceof Error &&
      /^Recovery stopped: \d+ of \d+ legacy rows could not be authenticated; no artifact was written$/.test(
        error.message,
      )
        ? error.message
        : 'Legacy reading recovery failed. No key, reading contents, ciphertext, or database credentials were logged.';
    console.error(message);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

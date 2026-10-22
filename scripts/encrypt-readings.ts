import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { ConfigModule } from '@nestjs/config';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { getEnvFiles } from '../src/config/env-files';
import { Reading } from '../src/readings/reading.entity';
import {
  decryptLegacyClientTree,
  getReadingEnvelopeVersion,
  ReadingEncryption,
  ReadingPayload,
  validateReadingEncryptionEnvironment,
} from '../src/readings/reading-encryption';
import { User } from '../src/users/user.entity';
import { OAuthAccount } from '../src/users/oauth-account.entity';
import { Session } from '../src/users/session.entity';

const MAX_BATCH_SIZE = 200;
const DEFAULT_BATCH_SIZE = 200;
const MAX_EXPECTED_UNREADABLE_LEGACY_IDS = 200;
const MAX_EXPECTED_IDS_FILE_BYTES = 32 * 1024;
const EXPECTED_IDS_ARGUMENT = '--expected-unreadable-legacy-ids-file=';

interface MigrationOptions {
  apply: boolean;
  reencrypt: boolean;
  rollbackToV2: boolean;
  expectedUnreadableLegacyIdsFile: string | null;
  expectedUnreadableLegacyIds: ReadonlySet<string>;
  lockRows?: boolean;
  batchSize: number;
}

interface BatchResult {
  batch: Reading[];
  eligible: number;
  alreadyCurrent: number;
  legacyDecryptionFailed: number;
  legacyPreserved: number;
  legacyDecryptionFailedIds: Set<string>;
}

interface MigrationSummary {
  scanned: number;
  eligible: number;
  alreadyCurrent: number;
  legacyDecryptionFailed: number;
  legacyPreserved: number;
  legacyDecryptionFailedIds: Set<string>;
  updated: number;
}

export function parseOptions(args: string[]): MigrationOptions {
  const knownFlags = new Set([
    '--apply',
    '--dry-run',
    '--reencrypt',
    '--rollback-to-v2',
  ]);
  const expectedIdsArgs = args.filter((arg) =>
    arg.startsWith(EXPECTED_IDS_ARGUMENT),
  );
  if (expectedIdsArgs.length > 1) {
    throw new Error('Provide only one expected unreadable ID file');
  }
  for (const arg of args) {
    if (arg.startsWith('--batch-size=')) continue;
    if (arg.startsWith(EXPECTED_IDS_ARGUMENT)) continue;
    if (!knownFlags.has(arg)) throw new Error('Unknown migration option');
  }
  const apply = args.includes('--apply');
  const dryRun = args.includes('--dry-run');
  const reencrypt = args.includes('--reencrypt');
  const rollbackToV2 = args.includes('--rollback-to-v2');
  const expectedUnreadableLegacyIdsFile = expectedIdsArgs.length
    ? expectedIdsArgs[0].slice(EXPECTED_IDS_ARGUMENT.length).trim()
    : null;
  if (expectedIdsArgs.length && !expectedUnreadableLegacyIdsFile) {
    throw new Error('Expected unreadable ID file path is required');
  }
  if (apply && dryRun) throw new Error('Choose either --apply or --dry-run');
  if (reencrypt && !apply) {
    throw new Error('--reencrypt requires --apply');
  }
  if (expectedUnreadableLegacyIdsFile && rollbackToV2) {
    throw new Error(
      'Expected unreadable ID files cannot be used with --rollback-to-v2',
    );
  }
  if (rollbackToV2 && reencrypt) {
    throw new Error('--rollback-to-v2 cannot be combined with --reencrypt');
  }

  const batchArg = args.find((arg) => arg.startsWith('--batch-size='));
  const batchSize = batchArg
    ? Number(batchArg.slice('--batch-size='.length))
    : DEFAULT_BATCH_SIZE;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_BATCH_SIZE
  ) {
    throw new Error(
      `--batch-size must be an integer from 1 to ${MAX_BATCH_SIZE}`,
    );
  }

  return {
    apply: apply && !dryRun,
    reencrypt,
    rollbackToV2,
    expectedUnreadableLegacyIdsFile,
    expectedUnreadableLegacyIds: new Set<string>(),
    batchSize,
  };
}

export async function loadExpectedUnreadableLegacyIds(
  filePath: string | null,
): Promise<ReadonlySet<string>> {
  if (!filePath) return new Set<string>();

  let file;
  try {
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0);
    file = await open(filePath, flags);
    const fileStat = await file.stat();
    if (
      !fileStat.isFile() ||
      fileStat.size > MAX_EXPECTED_IDS_FILE_BYTES ||
      (fileStat.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' &&
        fileStat.uid !== process.getuid())
    ) {
      throw new Error('Invalid private expected unreadable ID file');
    }

    const contents = await file.readFile({ encoding: 'utf8' });
    const ids = contents
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (
      ids.length > MAX_EXPECTED_UNREADABLE_LEGACY_IDS ||
      ids.some((id) => !/^[A-Za-z0-9_-]{1,128}$/.test(id)) ||
      new Set(ids).size !== ids.length
    ) {
      throw new Error('Invalid private expected unreadable ID file');
    }
    return new Set(ids);
  } catch {
    // Do not echo the file path or its contents into operator logs.
    throw new Error(
      'Unable to read a valid private expected unreadable ID file',
    );
  } finally {
    await file?.close();
  }
}

function assertExpectedUnreadableIdsMatch(
  actual: ReadonlySet<string>,
  expected: ReadonlySet<string>,
): void {
  if (
    actual.size !== expected.size ||
    [...actual].some((id) => !expected.has(id))
  ) {
    throw new Error(
      'Unreadable legacy reading set does not match the expected ID file',
    );
  }
}

function hasReadingEnvelope(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, '_enc')
  );
}

function getStorageTitle(app: string, type: string): string {
  const safeApp = app.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 20) || 'app';
  const safeType =
    type.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 50) || 'reading';
  return `${safeApp}:${safeType}`;
}

function decryptLegacyPayload(reading: Reading): ReadingPayload {
  const questionValue = decryptLegacyClientTree(
    reading.question,
    reading.userId,
  );
  const titleValue = decryptLegacyClientTree(reading.title, reading.userId);
  const data = decryptLegacyClientTree(reading.data, reading.userId);
  const question = toLegacyText(questionValue, true);
  const title = toLegacyText(titleValue, false);
  if (
    title === null ||
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    throw new Error('Unsupported legacy reading record');
  }
  return { question, title, data: data as Record<string, unknown> };
}

function toLegacyText(value: unknown, allowNull: boolean): string | null {
  if (value === null && allowNull) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

async function loadEnvironment(): Promise<void> {
  await ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: getEnvFiles(),
    validate: validateReadingEncryptionEnvironment,
  });
  // Migration requires an active key even when run outside production.
  new ReadingEncryption(
    process.env.DATA_ENCRYPTION_KEYS,
    process.env.DATA_ENCRYPTION_ACTIVE_KEY_ID,
    true,
  );
}

function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 5432),
    username: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || '',
    database: process.env.DATABASE_NAME || 'vinfi_sso',
    entities: [Reading, User, OAuthAccount, Session],
    synchronize: false,
    migrationsRun: false,
    logging: false,
  });
}

async function loadBatch(
  repo: Repository<Reading>,
  cursor: string | null,
  batchSize: number,
  lockRows: boolean,
): Promise<Reading[]> {
  let query: SelectQueryBuilder<Reading> = repo
    .createQueryBuilder('reading')
    .orderBy('reading.id', 'ASC')
    .take(batchSize);
  if (cursor) query = query.where('reading.id > :cursor', { cursor });
  if (lockRows) query = query.setLock('pessimistic_write');
  return query.getMany();
}

export async function processBatch(
  repo: Repository<Reading>,
  cursor: string | null,
  options: MigrationOptions,
  encryption: ReadingEncryption,
): Promise<BatchResult> {
  const batch = await loadBatch(
    repo,
    cursor,
    options.batchSize,
    options.apply || !!options.lockRows,
  );
  let alreadyCurrent = 0;
  let legacyDecryptionFailed = 0;
  let legacyPreserved = 0;
  const legacyDecryptionFailedIds = new Set<string>();
  const pending: Reading[] = [];

  for (const reading of batch) {
    const envelopeVersion = getReadingEnvelopeVersion(reading.data);
    if (hasReadingEnvelope(reading.data) && !envelopeVersion) {
      throw new Error('Unsupported encrypted reading envelope');
    }
    if (options.rollbackToV2) {
      if (envelopeVersion === 'v3') {
        const payload = encryption.decryptEnvelope(
          reading.data,
          reading.userId,
          reading.id,
        );
        pending.push({
          ...reading,
          data: encryption.encryptPayloadV2ForRollback(payload, reading.userId),
        });
      } else if (envelopeVersion === 'v2') {
        // Validate existing V2 ciphertext before declaring it rollback-ready.
        encryption.decryptEnvelope(reading.data, reading.userId, reading.id);
        alreadyCurrent += 1;
      } else {
        // V2 applications still understand historical client-encrypted rows.
        legacyPreserved += 1;
      }
      continue;
    }
    if (envelopeVersion === 'v3' && !options.reencrypt) {
      // Validate that all referenced keys and row-bound AAD are available,
      // even in dry-run mode.
      encryption.decryptEnvelope(reading.data, reading.userId, reading.id);
      alreadyCurrent += 1;
      continue;
    }

    let payload: ReadingPayload;
    if (envelopeVersion) {
      // Both V2 and V3 authentication/key errors remain fatal in every mode.
      payload = encryption.decryptEnvelope(
        reading.data,
        reading.userId,
        reading.id,
      );
    } else {
      try {
        payload = decryptLegacyPayload(reading);
      } catch {
        legacyDecryptionFailed += 1;
        legacyDecryptionFailedIds.add(reading.id);
        if (options.expectedUnreadableLegacyIds.has(reading.id)) {
          legacyPreserved += 1;
          continue;
        }
        if (options.apply) {
          throw new Error('Unreadable legacy reading record');
        }
        continue;
      }
    }
    pending.push({
      ...reading,
      question: null,
      title: getStorageTitle(reading.app, reading.type),
      data: encryption.encryptPayload(payload, reading.userId, reading.id),
    });
  }

  if (options.apply && pending.length > 0) await repo.save(pending);
  return {
    batch,
    eligible: pending.length,
    alreadyCurrent,
    legacyDecryptionFailed,
    legacyPreserved,
    legacyDecryptionFailedIds,
  };
}

export async function runPass(
  repo: Repository<Reading>,
  options: MigrationOptions,
  encryption: ReadingEncryption,
  dataSource: DataSource,
  transactionPerBatch = true,
): Promise<MigrationSummary> {
  let cursor: string | null = null;
  const summary: MigrationSummary = {
    scanned: 0,
    eligible: 0,
    alreadyCurrent: 0,
    legacyDecryptionFailed: 0,
    legacyPreserved: 0,
    legacyDecryptionFailedIds: new Set<string>(),
    updated: 0,
  };

  while (true) {
    const result: BatchResult =
      options.apply && transactionPerBatch
        ? await dataSource.transaction<BatchResult>((manager) =>
            processBatch(
              manager.getRepository(Reading),
              cursor,
              options,
              encryption,
            ),
          )
        : await processBatch(repo, cursor, options, encryption);
    if (result.batch.length === 0) break;
    cursor = result.batch[result.batch.length - 1].id;
    summary.scanned += result.batch.length;
    summary.eligible += result.eligible;
    summary.alreadyCurrent += result.alreadyCurrent;
    summary.legacyDecryptionFailed += result.legacyDecryptionFailed;
    summary.legacyPreserved += result.legacyPreserved;
    for (const id of result.legacyDecryptionFailedIds) {
      summary.legacyDecryptionFailedIds.add(id);
    }
    if (options.apply) summary.updated += result.eligible;
  }
  return summary;
}

export async function applyWithExpectedUnreadableLegacyIds(
  dataSource: DataSource,
  options: MigrationOptions,
  encryption: ReadingEncryption,
): Promise<MigrationSummary> {
  if (!options.apply || !options.expectedUnreadableLegacyIdsFile) {
    throw new Error('An apply run with a private expected ID file is required');
  }

  return dataSource.transaction('SERIALIZABLE', async (manager) => {
    const repo = manager.getRepository(Reading);
    const preflight = await runPass(
      repo,
      { ...options, apply: false, lockRows: true },
      encryption,
      dataSource,
      false,
    );
    assertExpectedUnreadableIdsMatch(
      preflight.legacyDecryptionFailedIds,
      options.expectedUnreadableLegacyIds,
    );

    // Apply inside the same transaction. Row locks acquired during preflight
    // remain held, and a second exact-set check rolls back all batches if the
    // observed failures change before commit.
    const applied = await runPass(
      repo,
      { ...options, lockRows: true },
      encryption,
      dataSource,
      false,
    );
    assertExpectedUnreadableIdsMatch(
      applied.legacyDecryptionFailedIds,
      options.expectedUnreadableLegacyIds,
    );
    return applied;
  });
}

export async function runValidatedDryRun(
  repo: Repository<Reading>,
  options: MigrationOptions,
  encryption: ReadingEncryption,
  dataSource: DataSource,
): Promise<MigrationSummary> {
  if (options.apply) throw new Error('A dry-run option is required');
  const summary = await runPass(repo, options, encryption, dataSource);
  assertExpectedUnreadableIdsMatch(
    summary.legacyDecryptionFailedIds,
    options.expectedUnreadableLegacyIds,
  );
  return summary;
}

function reportSummary(
  options: MigrationOptions,
  summary: MigrationSummary,
): void {
  const safeSummary = {
    scanned: summary.scanned,
    eligible: summary.eligible,
    alreadyCurrent: summary.alreadyCurrent,
    legacyDecryptionFailed: summary.legacyDecryptionFailed,
    legacyPreserved: summary.legacyPreserved,
    updated: summary.updated,
  };
  console.log(
    JSON.stringify({
      mode: options.apply ? 'apply' : 'dry-run',
      batchSize: options.batchSize,
      reencrypt: options.reencrypt,
      rollbackToV2: options.rollbackToV2,
      allowlistedLegacyExceptions: options.expectedUnreadableLegacyIds.size,
      ...safeSummary,
    }),
  );
}

async function migrate(options: MigrationOptions): Promise<void> {
  await loadEnvironment();
  const encryption = new ReadingEncryption(
    process.env.DATA_ENCRYPTION_KEYS,
    process.env.DATA_ENCRYPTION_ACTIVE_KEY_ID,
    true,
  );
  const dataSource = createDataSource();
  await dataSource.initialize();

  try {
    const repo = dataSource.getRepository(Reading);
    if (options.apply && options.expectedUnreadableLegacyIdsFile) {
      const summary = await applyWithExpectedUnreadableLegacyIds(
        dataSource,
        options,
        encryption,
      );
      reportSummary(options, summary);
      return;
    }

    if (options.apply) {
      // Validate every row before writing so known unreadable legacy records
      // cannot leave an earlier batch migrated by a default apply run.
      const preflight = await runPass(
        repo,
        { ...options, apply: false },
        encryption,
        dataSource,
      );
      reportSummary(options, preflight);
      try {
        assertExpectedUnreadableIdsMatch(
          preflight.legacyDecryptionFailedIds,
          options.expectedUnreadableLegacyIds,
        );
      } catch {
        throw new Error(
          'Unreadable legacy reading records found; no changes applied',
        );
      }
    }

    if (!options.apply) {
      const summary = await runValidatedDryRun(
        repo,
        options,
        encryption,
        dataSource,
      );
      reportSummary(options, summary);
      return;
    }

    const summary = await runPass(repo, options, encryption, dataSource);
    reportSummary(options, summary);
  } finally {
    await dataSource.destroy();
  }
}

async function main(): Promise<void> {
  try {
    const options = parseOptions(process.argv.slice(2));
    options.expectedUnreadableLegacyIds = await loadExpectedUnreadableLegacyIds(
      options.expectedUnreadableLegacyIdsFile,
    );
    await migrate(options);
  } catch {
    console.error(
      'Reading encryption migration failed. No record contents or configuration values were logged.',
    );
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

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

interface MigrationOptions {
  apply: boolean;
  reencrypt: boolean;
  rollbackToV2: boolean;
  skipUnreadableLegacy: boolean;
  batchSize: number;
}

interface BatchResult {
  batch: Reading[];
  eligible: number;
  alreadyCurrent: number;
  legacyDecryptionFailed: number;
  legacyPreserved: number;
}

interface MigrationSummary {
  scanned: number;
  eligible: number;
  alreadyCurrent: number;
  legacyDecryptionFailed: number;
  legacyPreserved: number;
  updated: number;
}

export function parseOptions(args: string[]): MigrationOptions {
  const knownFlags = new Set([
    '--apply',
    '--dry-run',
    '--reencrypt',
    '--rollback-to-v2',
    '--skip-unreadable-legacy',
  ]);
  for (const arg of args) {
    if (arg.startsWith('--batch-size=')) continue;
    if (!knownFlags.has(arg)) throw new Error('Unknown migration option');
  }
  const apply = args.includes('--apply');
  const dryRun = args.includes('--dry-run');
  const reencrypt = args.includes('--reencrypt');
  const rollbackToV2 = args.includes('--rollback-to-v2');
  const skipUnreadableLegacy = args.includes('--skip-unreadable-legacy');
  if (apply && dryRun) throw new Error('Choose either --apply or --dry-run');
  if (reencrypt && !apply) {
    throw new Error('--reencrypt requires --apply');
  }
  if (skipUnreadableLegacy && !apply) {
    throw new Error('--skip-unreadable-legacy requires --apply');
  }
  if (rollbackToV2 && reencrypt) {
    throw new Error('--rollback-to-v2 cannot be combined with --reencrypt');
  }
  if (rollbackToV2 && skipUnreadableLegacy) {
    throw new Error('--rollback-to-v2 cannot be combined with --skip-unreadable-legacy');
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
    skipUnreadableLegacy,
    batchSize,
  };
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
  const batch = await loadBatch(repo, cursor, options.batchSize, options.apply);
  let alreadyCurrent = 0;
  let legacyDecryptionFailed = 0;
  let legacyPreserved = 0;
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
          data: encryption.encryptPayloadV2ForRollback(
            payload,
            reading.userId,
          ),
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
        if (options.apply && !options.skipUnreadableLegacy) {
          throw new Error('Unreadable legacy reading record');
        }
        continue;
      }
    }
    reading.question = null;
    reading.title = getStorageTitle(reading.app, reading.type);
    reading.data = encryption.encryptPayload(
      payload,
      reading.userId,
      reading.id,
    );
    pending.push(reading);
  }

  if (options.apply && pending.length > 0) await repo.save(pending);
  return {
    batch,
    eligible: pending.length,
    alreadyCurrent,
    legacyDecryptionFailed,
    legacyPreserved,
  };
}

export async function runPass(
  repo: Repository<Reading>,
  options: MigrationOptions,
  encryption: ReadingEncryption,
  dataSource: DataSource,
): Promise<MigrationSummary> {
  let cursor: string | null = null;
  const summary: MigrationSummary = {
    scanned: 0,
    eligible: 0,
    alreadyCurrent: 0,
    legacyDecryptionFailed: 0,
    legacyPreserved: 0,
    updated: 0,
  };

  while (true) {
    const result: BatchResult = options.apply
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
    if (options.apply) summary.updated += result.eligible;
  }
  return summary;
}

function reportSummary(
  options: MigrationOptions,
  summary: MigrationSummary,
): void {
  console.log(
    JSON.stringify({
      mode: options.apply ? 'apply' : 'dry-run',
      batchSize: options.batchSize,
      reencrypt: options.reencrypt,
      rollbackToV2: options.rollbackToV2,
      skipUnreadableLegacy: options.skipUnreadableLegacy,
      ...summary,
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
    if (options.apply && !options.skipUnreadableLegacy) {
      // Validate every row before writing so known unreadable legacy records
      // cannot leave an earlier batch migrated by a default apply run.
      const preflight = await runPass(
        repo,
        { ...options, apply: false },
        encryption,
        dataSource,
      );
      if (preflight.legacyDecryptionFailed > 0) {
        reportSummary(options, preflight);
        throw new Error(
          'Unreadable legacy reading records found; no changes applied',
        );
      }
    }

    const summary = await runPass(repo, options, encryption, dataSource);
    reportSummary(options, summary);
    if (!options.apply && summary.legacyDecryptionFailed > 0) {
      throw new Error('Unreadable legacy reading records found during dry-run');
    }
  } finally {
    await dataSource.destroy();
  }
}

async function main(): Promise<void> {
  try {
    await migrate(parseOptions(process.argv.slice(2)));
  } catch {
    console.error(
      'Reading encryption migration failed. No record contents or configuration values were logged.',
    );
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

import { ConfigModule } from '@nestjs/config';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { getEnvFiles } from '../src/config/env-files';
import { Reading } from '../src/readings/reading.entity';
import {
  decryptLegacyClientTree,
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
  batchSize: number;
}

interface BatchResult {
  batch: Reading[];
  eligible: number;
  alreadyCurrent: number;
}

function parseOptions(args: string[]): MigrationOptions {
  const knownFlags = new Set(['--apply', '--dry-run', '--reencrypt']);
  for (const arg of args) {
    if (arg.startsWith('--batch-size=')) continue;
    if (!knownFlags.has(arg)) throw new Error('Unknown migration option');
  }
  const apply = args.includes('--apply');
  const dryRun = args.includes('--dry-run');
  const reencrypt = args.includes('--reencrypt');
  if (apply && dryRun) throw new Error('Choose either --apply or --dry-run');
  if (reencrypt && !apply) {
    throw new Error('--reencrypt requires --apply');
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

  return { apply: apply && !dryRun, reencrypt, batchSize };
}

function isV2ReadingData(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)._enc === 'string' &&
    ((value as Record<string, unknown>)._enc as string).startsWith('v2:')
  );
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

async function processBatch(
  repo: Repository<Reading>,
  cursor: string | null,
  options: MigrationOptions,
  encryption: ReadingEncryption,
): Promise<BatchResult> {
  const batch = await loadBatch(repo, cursor, options.batchSize, options.apply);
  let alreadyCurrent = 0;
  const pending: Reading[] = [];

  for (const reading of batch) {
    if (hasReadingEnvelope(reading.data) && !isV2ReadingData(reading.data)) {
      throw new Error('Unsupported encrypted reading envelope');
    }
    const encrypted = isV2ReadingData(reading.data);
    if (encrypted && !options.reencrypt) {
      // Validate that all referenced keys are available, even in dry-run mode.
      encryption.decryptEnvelope(reading.data, reading.userId);
      alreadyCurrent += 1;
      continue;
    }

    const payload = encrypted
      ? encryption.decryptEnvelope(reading.data, reading.userId)
      : decryptLegacyPayload(reading);
    reading.question = null;
    reading.title = getStorageTitle(reading.app, reading.type);
    reading.data = encryption.encryptPayload(payload, reading.userId);
    pending.push(reading);
  }

  if (options.apply && pending.length > 0) await repo.save(pending);
  return { batch, eligible: pending.length, alreadyCurrent };
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

  let cursor: string | null = null;
  let scanned = 0;
  let eligible = 0;
  let alreadyCurrent = 0;
  let updated = 0;

  try {
    const repo = dataSource.getRepository(Reading);
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
      const batch: Reading[] = result.batch;
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;
      scanned += batch.length;
      eligible += result.eligible;
      alreadyCurrent += result.alreadyCurrent;
      if (options.apply) updated += result.eligible;
    }
  } finally {
    await dataSource.destroy();
  }

  console.log(
    JSON.stringify({
      mode: options.apply ? 'apply' : 'dry-run',
      batchSize: options.batchSize,
      reencrypt: options.reencrypt,
      scanned,
      eligible,
      alreadyCurrent,
      updated,
    }),
  );
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

void main();

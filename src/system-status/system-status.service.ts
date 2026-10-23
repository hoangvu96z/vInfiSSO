import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createRequire } from 'node:module';
import { lstat, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import type {
  BackupFreshness,
  BackupHealth,
  DatabaseHealth,
  SystemStatusResponse,
} from './system-status.types';

const BACKUP_SUMMARY_PATH = '/var/lib/vinfi-sso/backup-summary.json';
const BACKUP_SUMMARY_MAX_AGE_MS = 26 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_SUMMARY_BYTES = 4096;
const PROBE_TIMEOUT_MS = 1500;

const ALLOWED_BACKUP_STATUSES = new Set<Exclude<BackupHealth, 'unknown'>>([
  'running',
  'failed',
  'offsite_failed',
  'local_only',
  'offsite_ok',
]);

interface RawBackupSummary {
  schemaVersion?: unknown;
  status?: unknown;
  updatedAtUtc?: unknown;
  localBackupReady?: unknown;
  offsiteBackupReady?: unknown;
}

export interface SanitizedBackupSummary {
  status: BackupHealth;
  freshness: BackupFreshness;
  updatedAtUtc: string | null;
  localBackupReady: boolean;
  offsiteBackupReady: boolean;
}

export interface PgProbeClient {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

export interface PgProbeConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: unknown;
  connectionTimeoutMillis: number;
  query_timeout: number;
  statement_timeout: number;
}

export type PgProbeClientFactory = (config: PgProbeConfig) => PgProbeClient;

const loadCommonJsModule = createRequire(__filename);
const pgClientFactory: PgProbeClientFactory = (config) => {
  const pg = loadCommonJsModule('pg') as {
    Client: new (clientConfig: PgProbeConfig) => PgProbeClient;
  };
  return new pg.Client(config);
};

function asObject(value: unknown): RawBackupSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function getSafeReadiness(
  status: BackupHealth,
  localBackupReady: boolean,
  offsiteBackupReady: boolean,
): boolean {
  if (status === 'offsite_ok') return localBackupReady && offsiteBackupReady;
  if (status === 'local_only') {
    return localBackupReady && !offsiteBackupReady;
  }
  if (status === 'offsite_failed') return localBackupReady;
  return true;
}

export async function readSanitizedBackupSummary(
  path = BACKUP_SUMMARY_PATH,
  now = new Date(),
  expectedOwnerUid = 0,
): Promise<SanitizedBackupSummary> {
  const unknown = (freshness: BackupFreshness): SanitizedBackupSummary => ({
    status: 'unknown',
    freshness,
    updatedAtUtc: null,
    localBackupReady: false,
    offsiteBackupReady: false,
  });

  let directoryMetadata;
  try {
    directoryMetadata = await lstat(dirname(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return unknown('missing');
    }
    return unknown('invalid');
  }

  const directoryPermissions = directoryMetadata.mode & 0o777;
  const processGroups = new Set([
    ...(typeof process.getgid === 'function' ? [process.getgid()] : []),
    ...(typeof process.getgroups === 'function' ? process.getgroups() : []),
  ]);
  if (
    !directoryMetadata.isDirectory() ||
    directoryMetadata.uid !== expectedOwnerUid ||
    !processGroups.has(directoryMetadata.gid) ||
    directoryPermissions !== 0o750
  ) {
    return unknown('invalid');
  }

  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return unknown('missing');
    }
    return unknown('invalid');
  }

  const permissions = metadata.mode & 0o777;
  if (
    !metadata.isFile() ||
    metadata.uid !== expectedOwnerUid ||
    !processGroups.has(metadata.gid) ||
    metadata.size <= 0 ||
    metadata.size > MAX_SUMMARY_BYTES ||
    permissions !== 0o640
  ) {
    return unknown('invalid');
  }

  let parsed: RawBackupSummary | null;
  try {
    const raw = await readFile(path, 'utf8');
    parsed = asObject(JSON.parse(raw) as unknown);
  } catch {
    return unknown('invalid');
  }

  if (
    !parsed ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.status !== 'string' ||
    !ALLOWED_BACKUP_STATUSES.has(
      parsed.status as Exclude<BackupHealth, 'unknown'>,
    ) ||
    typeof parsed.updatedAtUtc !== 'string' ||
    typeof parsed.localBackupReady !== 'boolean' ||
    typeof parsed.offsiteBackupReady !== 'boolean'
  ) {
    return unknown('invalid');
  }

  const timestamp = new Date(parsed.updatedAtUtc);
  const timestampMs = timestamp.getTime();
  if (
    !Number.isFinite(timestampMs) ||
    timestampMs > now.getTime() + MAX_FUTURE_SKEW_MS
  ) {
    return unknown('invalid');
  }

  const status = parsed.status as Exclude<BackupHealth, 'unknown'>;
  const updatedAtUtc = timestamp.toISOString();
  const localBackupReady = parsed.localBackupReady;
  const offsiteBackupReady = parsed.offsiteBackupReady;
  if (!getSafeReadiness(status, localBackupReady, offsiteBackupReady)) {
    return unknown('invalid');
  }

  if (now.getTime() - timestampMs > BACKUP_SUMMARY_MAX_AGE_MS) {
    return {
      status: 'unknown',
      freshness: 'stale',
      updatedAtUtc,
      localBackupReady: false,
      offsiteBackupReady: false,
    };
  }

  return {
    status,
    freshness: 'fresh',
    updatedAtUtc,
    localBackupReady,
    offsiteBackupReady,
  };
}

async function closeClientWithinDeadline(client: PgProbeClient): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      client.end().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 250);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function probeDatabase(
  options: DataSourceOptions,
  createClient: PgProbeClientFactory = pgClientFactory,
): Promise<DatabaseHealth> {
  if (options.type !== 'postgres') return 'unavailable';

  const config: PgProbeConfig = {
    host: options.host,
    port: options.port,
    user: options.username,
    password:
      typeof options.password === 'string' ? options.password : undefined,
    database: options.database,
    ssl: options.ssl,
    connectionTimeoutMillis: PROBE_TIMEOUT_MS,
    query_timeout: PROBE_TIMEOUT_MS,
    statement_timeout: PROBE_TIMEOUT_MS,
  };

  let client: PgProbeClient;
  try {
    client = createClient(config);
  } catch {
    return 'unavailable';
  }

  try {
    await client.connect();
    await client.query('SELECT 1');
    return 'available';
  } catch {
    return 'unavailable';
  } finally {
    await closeClientWithinDeadline(client);
  }
}

@Injectable()
export class SystemStatusService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getSystemStatus(): Promise<SystemStatusResponse> {
    const checkedAtUtc = new Date().toISOString();
    const [database, backup] = await Promise.all([
      probeDatabase(this.dataSource.options),
      readSanitizedBackupSummary(),
    ]);

    return {
      app: { status: 'ready', checkedAtUtc },
      database: { status: database },
      backup,
    };
  }
}

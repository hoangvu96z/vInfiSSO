import { mkdtemp, chmod, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import {
  probeDatabase,
  readSanitizedBackupSummary,
  SystemStatusService,
  type PgProbeClient,
} from './system-status.service';

describe('readSanitizedBackupSummary', () => {
  let directory: string;
  let file: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vinfi-status-'));
    await chmod(directory, 0o750);
    file = join(directory, 'backup-summary.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function writeSummary(payload: unknown, mode = 0o640) {
    await writeFile(file, JSON.stringify(payload));
    await chmod(file, mode);
  }

  function readSummary(now = new Date()) {
    return readSanitizedBackupSummary(file, now, process.getuid?.() ?? 0);
  }

  it('returns only allow-listed fields for a fresh verified offsite backup', async () => {
    const now = new Date('2026-10-23T04:00:00.000Z');
    await writeSummary({
      schemaVersion: 1,
      status: 'offsite_ok',
      updatedAtUtc: '2026-10-23T03:00:00.000Z',
      localBackupReady: true,
      offsiteBackupReady: true,
      runId: 'must-not-leak',
      stage: 'must-not-leak',
      errorExitCode: 123,
    });

    const summary = await readSummary(now);

    expect(summary).toEqual({
      status: 'offsite_ok',
      freshness: 'fresh',
      updatedAtUtc: '2026-10-23T03:00:00.000Z',
      localBackupReady: true,
      offsiteBackupReady: true,
    });
    expect(JSON.stringify(summary)).not.toMatch(/must-not-leak|errorExitCode/);
  });

  it('reports stale status as unknown without stale readiness claims', async () => {
    const now = new Date('2026-10-23T04:00:00.000Z');
    await writeSummary({
      schemaVersion: 1,
      status: 'offsite_ok',
      updatedAtUtc: '2026-10-21T01:00:00.000Z',
      localBackupReady: true,
      offsiteBackupReady: true,
    });

    await expect(readSummary(now)).resolves.toEqual({
      status: 'unknown',
      freshness: 'stale',
      updatedAtUtc: '2026-10-21T01:00:00.000Z',
      localBackupReady: false,
      offsiteBackupReady: false,
    });
  });

  it('distinguishes a missing summary from invalid, unsafe, or inconsistent data', async () => {
    await expect(
      readSummary(new Date('2026-10-23T04:00:00.000Z')),
    ).resolves.toMatchObject({ status: 'unknown', freshness: 'missing' });

    await writeFile(file, '{not-json');
    await chmod(file, 0o640);
    await expect(
      readSummary(new Date('2026-10-23T04:00:00.000Z')),
    ).resolves.toMatchObject({ status: 'unknown', freshness: 'invalid' });

    await writeSummary({
      schemaVersion: 1,
      status: 'offsite_ok',
      updatedAtUtc: '2026-10-23T03:00:00.000Z',
      localBackupReady: true,
      offsiteBackupReady: false,
    });
    await expect(
      readSummary(new Date('2026-10-23T04:00:00.000Z')),
    ).resolves.toMatchObject({ status: 'unknown', freshness: 'invalid' });

    await writeSummary(
      {
        schemaVersion: 1,
        status: 'local_only',
        updatedAtUtc: '2026-10-23T03:00:00.000Z',
        localBackupReady: true,
        offsiteBackupReady: false,
      },
      0o644,
    );
    await expect(
      readSummary(new Date('2026-10-23T04:00:00.000Z')),
    ).resolves.toMatchObject({ status: 'unknown', freshness: 'invalid' });
  });

  it('keeps backup freshness independent from a failed offsite attempt', async () => {
    await writeSummary({
      schemaVersion: 1,
      status: 'offsite_failed',
      updatedAtUtc: '2026-10-23T03:00:00.000Z',
      localBackupReady: true,
      offsiteBackupReady: true,
    });

    await expect(
      readSummary(new Date('2026-10-23T04:00:00.000Z')),
    ).resolves.toMatchObject({
      status: 'offsite_failed',
      freshness: 'fresh',
      localBackupReady: true,
      offsiteBackupReady: true,
    });
  });
});

describe('probeDatabase', () => {
  const postgresOptions = {
    type: 'postgres',
    host: 'db.internal',
    port: 5432,
    username: 'status-user',
    password: 'test-only-secret',
    database: 'app',
  } as DataSourceOptions;

  it('runs only a bounded SELECT 1 and maps failures to unavailable', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const query = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const end = jest.fn().mockResolvedValue(undefined);
    const client: PgProbeClient = { connect, query, end };
    const createClient = jest.fn(() => client);

    await expect(probeDatabase(postgresOptions, createClient)).resolves.toBe(
      'available',
    );
    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeoutMillis: 1500,
        query_timeout: 1500,
        statement_timeout: 1500,
      }),
    );

    const failedQuery = jest
      .fn()
      .mockRejectedValue(new Error('private database detail'));
    const failedClient: PgProbeClient = { connect, query: failedQuery, end };
    await expect(
      probeDatabase(postgresOptions, () => failedClient),
    ).resolves.toBe('unavailable');
    expect(end).toHaveBeenCalled();
  });

  it('does not create a PostgreSQL client for another database type', async () => {
    const createClient = jest.fn();
    await expect(
      probeDatabase(
        { type: 'better-sqlite3', database: ':memory:' },
        createClient,
      ),
    ).resolves.toBe('unavailable');
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('SystemStatusService', () => {
  it('returns the bounded API and sanitized backup contract', async () => {
    const service = new SystemStatusService({
      options: { type: 'better-sqlite3', database: ':memory:' },
    } as unknown as DataSource);

    const status = await service.getSystemStatus();

    expect(status.app.status).toBe('ready');
    expect(Number.isNaN(Date.parse(status.app.checkedAtUtc))).toBe(false);
    expect(status.database.status).toBe('unavailable');
    expect(status.backup.status).toBe('unknown');
    expect(['missing', 'invalid']).toContain(status.backup.freshness);
    expect(JSON.stringify(status)).not.toMatch(
      /password|runId|stage|errorExitCode/,
    );
  });
});

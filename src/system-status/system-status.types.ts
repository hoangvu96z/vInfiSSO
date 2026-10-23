export type DatabaseHealth = 'available' | 'unavailable';

export type BackupHealth =
  | 'running'
  | 'failed'
  | 'offsite_failed'
  | 'local_only'
  | 'offsite_ok'
  | 'unknown';

export type BackupFreshness = 'fresh' | 'stale' | 'missing' | 'invalid';

export interface SystemStatusResponse {
  app: {
    status: 'ready';
    checkedAtUtc: string;
  };
  database: {
    status: DatabaseHealth;
  };
  backup: {
    status: BackupHealth;
    freshness: BackupFreshness;
    updatedAtUtc: string | null;
    localBackupReady: boolean;
    offsiteBackupReady: boolean;
  };
}

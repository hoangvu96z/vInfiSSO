# Production backup and restore

`scripts/backup-vinfi.sh` writes an encrypted PostgreSQL custom dump, encrypted
`uploads/` archive, and encrypted application `.env`. Plaintext streams directly
through `age`; it is not written to a temporary file. Only ciphertext and
SHA-256 checksums are stored in the backup directory.

The `age` public recipient belongs in `/etc/vinfi-backup.conf`. Keep its
matching private key offline in a password manager and a second offline copy.
The VPS and Git repository must never contain that private key. The `.env`
backup includes the server-side reading encryption key, so loss of the private
`age` key would make both the backup and encrypted reading data unrecoverable.

## Install on the VPS

Install `age`, PostgreSQL client utilities, `rclone` only if offsite storage is
configured, and the standard `bash`, `tar`, `python3`, `flock`, and `runuser`
utilities. Copy the script and config template, then create a root-owned config:

```bash
sudo install -o root -g root -m 750 scripts/backup-vinfi.sh /usr/local/sbin/backup-vinfi.sh
sudo install -o root -g root -m 600 config/vinfi-backup.conf.example /etc/vinfi-backup.conf
sudoedit /etc/vinfi-backup.conf
```

Replace the example age recipient with the actual public recipient. The
matching private key must remain off the VPS. Leave both `BACKUP_RCLONE_*`
settings commented for local-only backups. To enable offsite copies, authorize
rclone first, then set both values and keep `/root/.config/rclone/rclone.conf`
owned by root with mode `600`. The destination must end in a dedicated
`vinfi-backup` directory.

Validate without opening the database or contacting a remote service:

```bash
sudo /usr/local/sbin/backup-vinfi.sh --dry-run
```

The dry run validates local configuration only. It does not prove the age
recipient, PostgreSQL access, or Drive authorization works. After configuration,
run one real backup manually and inspect `/var/backups/vinfi/status.json` before
installing the cron entry:

```bash
sudo /usr/local/sbin/backup-vinfi.sh
sudo cat /var/backups/vinfi/status.json
```

The status file contains only run metadata. Its `status` is `local_only` when
encrypted local artifacts are complete but no rclone remote is configured,
`offsite_ok` after upload and remote verification, `offsite_failed` when the
local backup succeeded but an offsite step failed, or `failed` when the local
backup did not complete. The file is atomically replaced and mode `600`.

The Admin UI reads a separate, allow-listed summary at
`/var/lib/vinfi-sso/backup-summary.json`. The backup script creates the
directory as `root:ubuntu` mode `750` and atomically replaces the summary as
`root:ubuntu` mode `640`. It contains only the status, timestamp, and local and
offsite readiness booleans; it never contains run IDs, stages, failure codes,
paths, logs, or backup contents. Publishing this UI summary is best-effort and
cannot fail the encrypted backup. The full status file and encrypted artifacts
remain private under `/var/backups/vinfi`.

After the manual run succeeds, install the root cron schedule:

```bash
sudo install -o root -g root -m 644 config/cron.d/vinfi-backup /etc/cron.d/vinfi-backup
sudo install -o root -g root -m 644 config/logrotate.d/vinfi-backup /etc/logrotate.d/vinfi-backup
```

The schedule runs at 02:00 server time. Local backups older than 7 days are
removed after a new local backup is checksummed. When rclone is configured,
daily remote copies are retained for 30 days and monthly copies for 365 days;
remote retention runs only after the new daily upload is verified. Cron failures
are appended to `/var/log/vinfi-backup.log`; logrotate retains 12 weekly files.
The full status file is not exposed through the application API. The protected
Admin system-status page reads only the separate sanitized summary and reports
missing, invalid, or older-than-26-hour summaries as unknown or stale.

The GitHub deployment workflow stages the checked-in backup script, installs it
as a `root:root` mode `750` sibling temporary file, verifies it, and atomically
renames it over the installed runner. It then runs the existing offsite backup
gate before copying application artifacts or applying migrations. The SSH
deployment account must be allowed to run
`/usr/bin/install -o root -g root -m 0750` and `/usr/bin/mv -T` non-interactively,
and to invoke the fixed backup runner through `sudo -n`.

## Restore check

Restore into a new, isolated database first. Do not restore a dump over the
production database as a verification step. On a trusted machine with the age
private key:

```bash
age -d -i /secure/offline/age-key.txt db.dump.age > db.dump
pg_restore --list db.dump
age -d -i /secure/offline/age-key.txt uploads.tar.gz.age | tar -tzf -
```

To test an actual restore, create a new empty PostgreSQL database and use
`pg_restore --no-owner --dbname=<new_database> db.dump`, then verify expected
tables and row counts. Restore the matching `users` and `readings` rows together
so their UUID relationships remain intact. Decrypt `app.env.age` only on a
trusted recovery machine and do not print or commit its contents.

Keep the encrypted backup offsite before applying schema migrations. A local
backup on the same VPS does not protect against VPS loss or compromise.

## Journal schema deployment gate

The production deployment workflow creates a new backup before copying the
release. It requires `/usr/local/sbin/backup-vinfi.sh` to exit successfully and
emit its exact `Backup complete: ... status=offsite_ok offsite=verified` marker;
local-only backups do not emit this marker. The script emits it only after the
encrypted artifacts pass local SHA-256 verification, the rclone upload and
remote `rclone check --one-way` succeed, and the final status is written. The
workflow captures the script output, checks the marker, and prints only a
generic pass/fail message. Since the script runs during that deployment, this
gates on a fresh backup. Missing rclone configuration, bad checksums, or any
backup error stops deployment before database migration or PM2 restart.

The configured Actions SSH user must be allowed to run exactly
`/usr/local/sbin/backup-vinfi.sh` through non-interactive `sudo -n`. The workflow
does not prompt for a sudo password; if this permission is unavailable, the
backup step fails and deployment stops before migration or restart.

After the new release is copied and production dependencies are installed,
`dist/scripts/deploy-journal-migration.js` checks the configured PostgreSQL
target, acquires a PostgreSQL advisory lock, and inspects TypeORM migration
history. It refuses to run if any migration other than
`SpiritualJournal1792800000000` is pending. It passes only that migration to
TypeORM inside a transaction, then verifies migration history and the Journal
table columns, constraints, and index before committing. If the migration or
verification fails, the transaction is rolled back and the workflow stops
before PM2 is restarted. The currently running app remains available while
the backup and migration steps run.

The deployment sequence is:

1. Build and verify the compiled app and guarded migration runner in CI.
2. Check the VPS Node.js runtime.
3. Create the encrypted backup and require the script's success marker after
   local checksum and offsite verification.
4. Copy the build and install production dependencies.
5. Run the guarded Journal migration and schema verification.
6. Restart PM2 and run the SSO health check.

Each retry creates another fresh offsite backup. If the migration already
committed but a later restart or health check failed, the next deploy verifies
the existing migration and schema before attempting the restart again. The
runner is safe to exercise with unit tests and a disposable PostgreSQL database;
do not invoke it manually against production outside the gated workflow.

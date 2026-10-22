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
sudo install -o root -g root -m 700 scripts/backup-vinfi.sh /usr/local/sbin/backup-vinfi.sh
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
The status file is not exposed through the application API; monitoring
integration is a separate task.

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

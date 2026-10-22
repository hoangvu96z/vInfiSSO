# vInfiSSO Backup and Restore Runbook

## Current production setup and verification status

As of 2026-10-22, the VPS runs the backup job from
`/usr/local/sbin/backup-vinfi.sh`, scheduled by `/etc/cron.d/vinfi-backup` at
02:00 server time as root. The script source in this repository is
[`scripts/backup-vinfi.sh`](scripts/backup-vinfi.sh). Encrypted files are kept
locally under `/var/backups/vinfi/<run-id>/`; the configured Google Drive
destination is `gdrive:vinfi-backup`, with daily copies below
`daily/YYYY-MM-DD/<run-id>/` and monthly copies below
`monthly/YYYY-MM/<run-id>/`. The status file is
`/var/backups/vinfi/status.json` and the cron log is
`/var/log/vinfi-backup.log`.

The backup run `2026-10-22T132519Z` completed with `offsite_ok`, and SHA-256
checks passed for the encrypted database dump, uploads archive, and app
environment file. This verifies that the ciphertext reached Drive and matches
the local checksums. It does **not** verify age decryption or a database/files
restore: the offline age identity was not available to the operator. Until the
owner makes that identity available through a secure local path, treat restore
as unverified and do not claim a completed restore drill.

This runbook covers the PostgreSQL database, `uploads/`, and the server-only
`.env` file. Backups are encrypted with `age` before they are written to local
backup storage or uploaded to Google Drive. The `age` private identity must stay
offline; the server stores only the public recipient.

## Backup schedule and retention

The production cron runs `/usr/local/sbin/backup-vinfi.sh` daily at 02:00
server time as root. Each run creates a unique UTC run ID and stores:

- Local encrypted files under `/var/backups/vinfi/<run-id>/`, retained for 7 days.
- A Drive copy under
  `gdrive:vinfi-backup/daily/YYYY-MM-DD/<run-id>/`, retained for 30 days.
- On the first day of each month, a second Drive copy under
  `gdrive:vinfi-backup/monthly/YYYY-MM/<run-id>/`, retained for 365 days
  (approximately 12 months).

The script uploads and verifies the new daily copy before applying remote or
local retention. It uses a non-blocking lock to prevent concurrent runs. A
failed upload leaves completed local encrypted artifacts in place. It does not
write a plaintext database dump, uploads archive, or `.env` copy to disk.

## One-time server setup

1. Install `age`, `rclone`, `postgresql-client`, and the standard Linux tools
   used by the script (`flock`, `runuser`, `tar`, `sha256sum`). The current VPS
   runs `/usr/local/sbin/backup-vinfi.sh`; run it on the Linux VPS as root.
2. On a trusted offline machine, generate an age identity with `age-keygen`.
   Store the private identity in the organization password manager and a
   separate offline recovery location. Do not copy it to the VPS, repository,
   chat, or logs. Put only the public `age1...` recipient in the server
   configuration. Keep the private file mode `0600` and remove working copies
   after storing the protected recovery copy.

   ```bash
   umask 077
   age-keygen -o vinfi-backup-age.key
   age-keygen -y vinfi-backup-age.key > vinfi-backup-age.pub
   chmod 0600 vinfi-backup-age.key vinfi-backup-age.pub
   ```

3. Configure rclone on the VPS as root using a dedicated Google account with
   2FA and the `drive.file` scope. Keep its config at
   `/root/.config/rclone/rclone.conf`, owned by root with mode `0600`. Do not
   print or commit the config or its OAuth token. Let rclone create the
   `vinfi-backup` folder under its own Drive app authorization; keep the scope
   at `drive.file`.
4. Create `/etc/vinfi-backup.conf` owned by root with mode `0600`. It accepts
   simple `KEY=value` lines only; do not add shell expansions or commands. Set the
   values below to match the deployed host. The current app root is
   `/var/www/sso.vunph.click`; confirm it before a restore without copying or
   printing `.env` contents.

   ```bash
   BACKUP_APP_ROOT=/var/www/sso.vunph.click
   BACKUP_ENV_FILE=/var/www/sso.vunph.click/.env
   BACKUP_UPLOADS_PATH=uploads
   BACKUP_DATABASE_NAME=vinfi_sso
   BACKUP_POSTGRES_OS_USER=postgres
   BACKUP_LOCAL_ROOT=/var/backups/vinfi
   BACKUP_RCLONE_REMOTE=gdrive:vinfi-backup
   BACKUP_RCLONE_CONFIG=/root/.config/rclone/rclone.conf
   BACKUP_AGE_RECIPIENT=age1REPLACE_WITH_PUBLIC_RECIPIENT
   ```

   Use these exact assignment forms, with no `export`, command substitution,
   whitespace in values, or secret values. The private age identity and Google
   OAuth token do not belong in this file. Protect and create the paths:

   ```bash
   sudo test -e /etc/vinfi-backup.conf || sudo touch /etc/vinfi-backup.conf
   sudo chown root:root /etc/vinfi-backup.conf
   sudo chmod 0600 /etc/vinfi-backup.conf
   sudo install -d -o root -g root -m 0700 /var/backups/vinfi
   sudo chmod 0600 /root/.config/rclone/rclone.conf
   sudo install -o root -g root -m 0750 scripts/backup-vinfi.sh \
     /usr/local/sbin/backup-vinfi.sh
   ```

   Edit the config with `sudoedit /etc/vinfi-backup.conf`. The database command
   runs as the PostgreSQL OS account and expects local peer/trust policy that
   permits that account to dump `vinfi_sso` over `/var/run/postgresql`. Do not
   put a database password in
   the script, config, command line, or cron environment.
5. Validate the local paths, permissions, required commands, and config format
   without connecting to the database or Drive:

   ```bash
   sudo /usr/local/sbin/backup-vinfi.sh --dry-run
   ```

   This does not verify the age recipient, PostgreSQL permissions, rclone remote,
   or Google authorization. Confirm those during the first scheduled backup
   while monitoring only the exit status and encrypted artifact names.

   Install the repository's cron and logrotate files at the production paths.
   The cron entry runs at 02:00 server time as root. Keep cron output in a
   root-only log; the script itself never enables shell tracing and does not
   print command arguments, plaintext, key material, or OAuth tokens.

   ```bash
   sudo install -o root -g root -m 0644 config/cron.d/vinfi-backup /etc/cron.d/vinfi-backup
   sudo install -o root -g root -m 0644 config/logrotate.d/vinfi-backup /etc/logrotate.d/vinfi-backup
   ```

   Create `/var/log/vinfi-backup.log` as root with mode `0600` and configure
   log rotation. Confirm the first successful run from the exit status and the
   encrypted files in Drive. Do not run an unmocked backup during setup review.

## Restore a backup for verification

Restore drills should run monthly in an isolated staging area and a separate
temporary database. Never use the production database name for a drill. The age
private identity stays on the trusted recovery workstation and is never copied
to the VPS. VPS commands assume a root shell (`sudo -i`). On the recovery
workstation, use an encrypted volume and set `umask 077` before decrypting.
Database commands deliberately switch to the PostgreSQL OS user.

1. Select a run ID and copy its encrypted directory from Drive to a root-only
   staging directory on the VPS. The remote path is either
   `gdrive:vinfi-backup/daily/YYYY-MM-DD/<run-id>` or
   `gdrive:vinfi-backup/monthly/YYYY-MM/<run-id>`.

   ```bash
   install -d -o root -g root -m 0700 /var/tmp/vinfi-restore/encrypted/RUN_ID
   rclone copy gdrive:vinfi-backup/daily/YYYY-MM-DD/RUN_ID \
     /var/tmp/vinfi-restore/encrypted/RUN_ID
   cd /var/tmp/vinfi-restore/encrypted/RUN_ID
   sha256sum -c SHA256SUMS
   ```

2. Transfer the encrypted directory to the trusted recovery workstation over
   SSH. Verify `SHA256SUMS` there too. Keep the private identity on that
   workstation only, outside the repository and encrypted backup directory, at
   mode `0600`. Decrypt to a protected temporary directory; do not print the
   `.env` file or its values.

   ```bash
   umask 077
   install -d -m 0700 /secure/restore/RUN_ID/plain
   cd /secure/restore/RUN_ID
   sha256sum -c SHA256SUMS
   age -d -i /secure/offline/vinfi-backup-age.key -o plain/db.dump db.dump.age
   age -d -i /secure/offline/vinfi-backup-age.key -o plain/uploads.tar.gz uploads.tar.gz.age
   age -d -i /secure/offline/vinfi-backup-age.key -o plain/app.env app.env.age
   ```

3. Validate archive paths without printing user filenames, then extract into a
   new staging directory on the recovery workstation. Every member must be
   under `uploads/`.

   ```bash
   set -o pipefail
   tar -tzf /secure/restore/RUN_ID/plain/uploads.tar.gz \
     | awk '$0 !~ /^uploads(\/|$)/ || $0 ~ /(^|\/)\.\.(\/|$)/ || $0 ~ /^\// { bad=1 } END { exit bad }' \
     || { printf 'Archive path validation failed.\n' >&2; exit 1; }
   install -d -m 0700 /secure/restore/RUN_ID/files
   tar -xzf /secure/restore/RUN_ID/plain/uploads.tar.gz \
     -C /secure/restore/RUN_ID/files --no-same-owner
   ```

   Transfer only `db.dump`, `uploads.tar.gz`, and `app.env` to the restore host
   using the approved SSH/SFTP process. Create
   `/var/tmp/vinfi-restore/plain` there first with owner root and mode `0700`.
   The age private identity is not needed on that host.

4. Restore the database into an empty temporary database owned by the expected
   application role (or into a dedicated test role with equivalent grants):

   ```bash
   sudo -u postgres createdb --owner=vinfi_sso vinfi_restore_test
   sudo -u postgres pg_restore --exit-on-error --no-owner --dbname=vinfi_restore_test \
     /var/tmp/vinfi-restore/plain/db.dump
   ```

   Check expected tables and row counts, then start a staging copy of the
   application pointed only at `vinfi_restore_test`. Verify that an encrypted
   reading can be fetched and decrypted with the restored environment keyring,
   and that a note with an image can be opened. Do not paste database rows or
   decrypted reading content into logs or chat. Drop the temporary database and
   securely remove the decrypted staging files when the drill is complete.

   ```bash
   sudo -u postgres dropdb --if-exists vinfi_restore_test
   ```

## Production restore

Production restore overwrites live state. The operator must verify the selected
run ID, obtain the incident/change approval required by the organization, and
confirm that the age private identity is available before proceeding.
Use a root shell for the command blocks below.

1. Copy the chosen encrypted run to root-only staging and verify `SHA256SUMS`.
   Decrypt on the trusted recovery workstation as described above, then
   transfer only the decrypted restore files to the root-only staging directory
   on the VPS. Never copy the age private identity to the VPS.
2. Stop the vInfiSSO process (`pm2 stop vinfi-sso`; verify the configured PM2
   process name before running the command). Take a fresh encrypted backup of
   the current database and uploads before replacing them, if the current state
   remains accessible.
3. Restore PostgreSQL. Confirm the target name and dump before running this
   command: `--clean --if-exists` drops objects in the target database.

   ```bash
   sudo -u postgres pg_restore --exit-on-error --clean --if-exists --no-owner \
     --dbname=vinfi_sso /var/tmp/vinfi-restore/plain/db.dump
   ```

4. Replace uploads reversibly. Set `APP_ROOT`, `RUN_ID`, `APP_OWNER`, and
   `APP_GROUP` to the verified deployment path, selected run ID, and runtime
   account. Extract a second copy on the app filesystem, then swap the directory
   names so the old directory remains available for rollback:

   ```bash
   APP_ROOT=/var/www/sso.vunph.click
   RUN_ID=REPLACE_WITH_SELECTED_RUN_ID
   APP_OWNER=REPLACE_WITH_RUNTIME_USER
   APP_GROUP=REPLACE_WITH_RUNTIME_GROUP
   test ! -e "$APP_ROOT/uploads.pre-restore.$RUN_ID"
   sudo install -d -o root -g root -m 0700 "$APP_ROOT/.restore-staging/$RUN_ID"
   sudo tar -xzf /var/tmp/vinfi-restore/plain/uploads.tar.gz \
     -C "$APP_ROOT/.restore-staging/$RUN_ID" --no-same-owner
   sudo mv "$APP_ROOT/uploads" "$APP_ROOT/uploads.pre-restore.$RUN_ID"
   sudo mv "$APP_ROOT/.restore-staging/$RUN_ID/uploads" "$APP_ROOT/uploads"
   sudo chown -R "$APP_OWNER:$APP_GROUP" "$APP_ROOT/uploads"
   ```

5. Before replacing `.env`, encrypt the current file to the root-only backup
   directory with the server's public age recipient. Then atomically install the
   decrypted file at the actual server `.env` path with the runtime owner and
   mode `0600`. Do not print it. It contains the `DATA_ENCRYPTION_KEYS` needed
   to read encrypted readings; losing or mismatching those keys makes
   corresponding readings unrecoverable.

   ```bash
   AGE_PUBLIC_RECIPIENT=REPLACE_WITH_SERVER_PUBLIC_RECIPIENT
   sudo install -d -o root -g root -m 0700 /var/backups/vinfi
   sudo age -r "$AGE_PUBLIC_RECIPIENT" \
     -o "/var/backups/vinfi/pre-restore-$RUN_ID-app.env.age" "$APP_ROOT/.env"
   sudo install -o "$APP_OWNER" -g "$APP_GROUP" -m 0600 \
     /var/tmp/vinfi-restore/plain/app.env "$APP_ROOT/.env.restore.$RUN_ID"
   sudo mv "$APP_ROOT/.env.restore.$RUN_ID" "$APP_ROOT/.env"
   ```

6. Start the application with the code version compatible with the restored DB
   schema. Check service health, SSO login, a reading read/decrypt, and a note
   image. Keep the old database, uploads, and env backups until recovery is
   accepted. If validation fails, stop the service and restore the previous
   database, uploads, and env as a matched set.
7. Remove temporary plaintext, the temporary private-identity working copy, and
   `.restore-staging/$RUN_ID` only after recovery is complete. Preserve the
   protected offline identity. Use the system's approved secure deletion or
   encrypted-volume disposal process; do not leave decrypted dumps or `.env`
   copies in the repository or Drive.

## Recovery objectives and ownership

- Target RPO: 24 hours, assuming the daily backup completed.
- Target RTO: under 1 hour for a healthy VPS and a verified restore set.
- The service owner is responsible for checking the daily cron result and
  monthly restore drill. A green upload alone is not a restore test.
- Keep the age private identity and production reading-encryption keyring in
  separate protected recovery locations. The server should retain only the age
  public recipient and the encrypted backups.

# vInfiSSO Backup and Restore Runbook

## Current production setup and verification status

As of 2026-10-24, the backup job is installed at
`/usr/local/sbin/backup-vinfi.sh`, with a root cron entry in
`/etc/cron.d/vinfi-backup` scheduled for 02:00 server time. The script source
in this repository is
[`scripts/backup-vinfi.sh`](scripts/backup-vinfi.sh). Encrypted files are kept
locally under `/var/backups/vinfi/<run-id>/`; the configured Google Drive
destination is `gdrive:vinfi-backup`, with daily copies below
`daily/YYYY-MM-DD/<run-id>/` and monthly copies below
`monthly/YYYY-MM/<run-id>/`. The status file is
`/var/backups/vinfi/status.json` and the cron log is
`/var/log/vinfi-backup.log`.

The cron entry is scheduled daily at 02:00 server time. The latest successful
run below proves the backup path works, but its timestamp alone does not prove
that cron invoked it; keep unattended execution unverified until a cron log
entry or a scheduled run is confirmed.

The backup run `2026-10-23T230623Z` completed with `offsite_ok` at
`2026-10-23T23:06:54Z`. On 2026-10-24, its manifest hashes were verified, all
three age-encrypted artifacts decrypted on the FileVault-encrypted recovery
workstation, and the uploads archive passed path/type checks. An isolated local
PostgreSQL 14 restore recovered 9 users, 163 readings, and 5 notes; the app's
`ReadingEncryption` decrypted a reading, both referenced Note images matched
restored files, and a referenced image opened as a valid WebP. The temporary
database, cluster, plaintext, and extracted files were removed. This closes the restore
drill for that run; continue monthly drills with a newer run.

This runbook covers the PostgreSQL database, `uploads/`, and the server-only
`.env` file. Backups are encrypted with `age` before they are written to local
backup storage or uploaded to Google Drive. The `age` private identity must stay
offline; the server stores only the public recipient.

## Backup schedule and retention

The installed production cron entry schedules
`/usr/local/sbin/backup-vinfi.sh` daily at 02:00 server time as root. Each run
creates a unique UTC run ID and stores:

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

Restore drills should run monthly and stay entirely on the trusted recovery
workstation using an encrypted volume and a temporary user-owned PostgreSQL
cluster inside `$WORK_DIR` bound only to a local Unix socket. Never use the
production database or VPS for a verification restore, never transfer decrypted
`db.dump`, `uploads.tar.gz`, or `app.env` to the VPS during a drill, and never
start a staging application with the production `.env`. The `age` private
identity stays on the trusted recovery workstation at mode `0600` and is never
copied to the VPS.

1. On the trusted recovery workstation, mount the encrypted recovery volume
   (for example `/secure/restore`), set `umask 077`, create an unpredictable
   working directory with `mktemp -d`, and register an `EXIT` trap that drops
   the temporary database when running, stops the local PostgreSQL cluster, and
   deletes `$WORK_DIR` on both success and failure.

   ```bash
   set -Eeuo pipefail
   umask 077
   RUN_ID=REPLACE_WITH_SELECTED_RUN_ID
   REMOTE_SUBPATH=daily/YYYY-MM-DD/$RUN_ID
   VPS_SSH_TARGET=ubuntu@VPS_HOST
   REPO_DIR=/path/to/vInfiSSO
   RESTORE_DB_ROLE=vinfi_restore_role
   RESTORE_DB_NAME=vinfi_restore_test
   PG_BIN_DIR=$(pg_config --bindir)

   [[ "$RUN_ID" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$ ]] \
     || { printf 'Invalid backup run ID.\n' >&2; exit 1; }
   [[ "$REMOTE_SUBPATH" =~ ^daily/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$ || \
      "$REMOTE_SUBPATH" =~ ^monthly/[0-9]{4}-[0-9]{2}/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$ ]] \
     || { printf 'Invalid backup path.\n' >&2; exit 1; }
   [[ "$REMOTE_SUBPATH" == */"$RUN_ID" ]] \
     || { printf 'Backup path does not match run ID.\n' >&2; exit 1; }

   test -d /secure/restore && ! test -L /secure/restore
   WORK_DIR=$(mktemp -d /secure/restore/drill.XXXXXX)
   chmod 0700 "$WORK_DIR"
   PG_DATA_DIR="$WORK_DIR/pgdata"
   PG_SOCKET_DIR="$WORK_DIR/pgsock"
   PG_LOG_FILE="$WORK_DIR/postgres.log"
   install -d -m 0700 "$WORK_DIR/encrypted" "$WORK_DIR/plain" "$WORK_DIR/files" "$PG_SOCKET_DIR"

   cleanup_drill() {
     if [[ -n "${PG_DATA_DIR:-}" && -f "$PG_DATA_DIR/postmaster.pid" ]]; then
       "$PG_BIN_DIR/dropdb" --if-exists --host="$PG_SOCKET_DIR" "$RESTORE_DB_NAME" >/dev/null 2>&1 || true
       "$PG_BIN_DIR/pg_ctl" -D "$PG_DATA_DIR" -m fast -w stop >/dev/null 2>&1 || true
     fi
     if [[ -n "${WORK_DIR:-}" && -d "$WORK_DIR" ]]; then
       rm -rf -- "$WORK_DIR"
     fi
   }
   trap cleanup_drill EXIT
   ```

2. Fetch only ciphertext and `SHA256SUMS` from VPS-side `rclone` over SSH into
   `$WORK_DIR/encrypted` using the configured SSH user (for example key-only
   `ubuntu`) and `sudo -n`. On the VPS, stage ciphertext in a randomized
   directory under root-owned `/var/backups/vinfi` (mode `0700`, non-symlink,
   never `/var/tmp`), pass `--config=/root/.config/rclone/rclone.conf`, verify
   `SHA256SUMS` (comparing against `/var/backups/vinfi/$RUN_ID/SHA256SUMS` when
   within the 7-day local retention window), stream only the encrypted files
   over SSH, and remove the VPS staging directory immediately.

   ```bash
   ssh "$VPS_SSH_TARGET" "sudo -n bash -s -- '$RUN_ID' '$REMOTE_SUBPATH'" <<'REMOTE_SH' \
     | tar -C "$WORK_DIR/encrypted" -xf - --no-same-owner --no-same-permissions
   set -Eeuo pipefail
   umask 077
   run_id="$1"
   remote_subpath="$2"
   [[ "$run_id" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$ ]]
   [[ "$remote_subpath" =~ ^(daily/[0-9]{4}-[0-9]{2}-[0-9]{2}|monthly/[0-9]{4}-[0-9]{2})/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$ ]]
   test -d /var/backups/vinfi && ! test -L /var/backups/vinfi
   test "$(stat -c '%u %a' /var/backups/vinfi)" = "0 700"
   stage_dir=$(mktemp -d /var/backups/vinfi/.drill-encrypted.XXXXXX)
   trap 'rm -rf -- "$stage_dir"' EXIT
   rclone --config=/root/.config/rclone/rclone.conf --log-level ERROR \
     copy "gdrive:vinfi-backup/$remote_subpath" "$stage_dir"
   if test -f "/var/backups/vinfi/$run_id/SHA256SUMS"; then
     cmp -s "/var/backups/vinfi/$run_id/SHA256SUMS" "$stage_dir/SHA256SUMS"
   fi
   (cd "$stage_dir" && sha256sum -c --strict SHA256SUMS >&2)
   tar -C "$stage_dir" -cf - SHA256SUMS db.dump.age uploads.tar.gz.age app.env.age
   REMOTE_SH
   ```

3. On the recovery workstation, verify that `SHA256SUMS` lists only the three
   expected encrypted artifacts (`app.env.age`, `db.dump.age`,
   `uploads.tar.gz.age`) with valid digests, then decrypt locally into
   `$WORK_DIR/plain`. Keep the offline `age` private identity outside the
   repository and backup directories at mode `0600`. Do not print `app.env` or
   its values.

   ```bash
   cd "$WORK_DIR/encrypted"
   awk 'NF != 2 { bad=1 } { print $2 } END { exit bad }' SHA256SUMS \
     | LC_ALL=C sort \
     | diff -u - <(printf 'app.env.age\ndb.dump.age\nuploads.tar.gz.age\n') >/dev/null
   sha256sum -c --strict SHA256SUMS

   age -d -i /secure/offline/vinfi-backup-age.key -o "$WORK_DIR/plain/db.dump" db.dump.age
   age -d -i /secure/offline/vinfi-backup-age.key -o "$WORK_DIR/plain/uploads.tar.gz" uploads.tar.gz.age
   age -d -i /secure/offline/vinfi-backup-age.key -o "$WORK_DIR/plain/app.env" app.env.age
   chmod 0600 "$WORK_DIR/plain/db.dump" "$WORK_DIR/plain/uploads.tar.gz" "$WORK_DIR/plain/app.env"
   ```

4. Validate archive entry types and paths on the recovery workstation without
   printing user filenames, then extract into `$WORK_DIR/files`. Every member
   must be under `uploads/`, and symbolic links, hard links, device nodes,
   FIFOs, and sockets must be rejected before and after extraction.

   ```bash
   tar -tvzf "$WORK_DIR/plain/uploads.tar.gz" \
     | awk 'NR == 0 { bad=1 } $1 !~ /^[-d][rwxstST-]{9}$/ { bad=1 } END { if (NR == 0) bad=1; exit bad }' \
     || { printf 'Archive entry-type validation failed (links or special files rejected).\n' >&2; exit 1; }

   tar -tzf "$WORK_DIR/plain/uploads.tar.gz" \
     | awk 'NR == 0 { bad=1 } $0 !~ /^uploads(\/|$)/ || $0 ~ /(^|\/)\.\.(\/|$)/ || $0 ~ /^\// { bad=1 } END { if (NR == 0) bad=1; exit bad }' \
     || { printf 'Archive path validation failed.\n' >&2; exit 1; }

   tar -xzf "$WORK_DIR/plain/uploads.tar.gz" \
     -C "$WORK_DIR/files" --no-same-owner --no-same-permissions

   test -z "$(find "$WORK_DIR/files" \( -type l -o \( ! -type f ! -type d \) \) -print -quit)" \
     || { printf 'Post-extraction file-type validation failed.\n' >&2; exit 1; }
   ```

5. Initialize and start a temporary PostgreSQL cluster inside `$WORK_DIR` owned
   by the current recovery-workstation user and bound only to `$PG_SOCKET_DIR`
   (`listen_addresses=''`). The backup uses `pg_dump --no-owner`, which omits
   `ALTER OWNER` statements but retains `GRANT`/`REVOKE` ACLs referencing
   production roles. In an isolated workstation cluster where production role
   ACL targets do not exist, `pg_restore --exit-on-error` fails unless
   `--no-acl` is passed. Pass `--no-acl` alongside `--no-owner` and
   `--role="$RESTORE_DB_ROLE"` for this **isolated verification restore only**
   (production restores on the live host preserve ACLs).

   ```bash
   "$PG_BIN_DIR/initdb" -D "$PG_DATA_DIR" --auth=trust --no-instructions >/dev/null
   "$PG_BIN_DIR/pg_ctl" -D "$PG_DATA_DIR" -l "$PG_LOG_FILE" -w \
     -o "-F -c listen_addresses='' -c unix_socket_directories='$PG_SOCKET_DIR' -c unix_socket_permissions=0700" start >/dev/null

   "$PG_BIN_DIR/createuser" --host="$PG_SOCKET_DIR" --no-superuser --no-createdb --no-createrole "$RESTORE_DB_ROLE"
   "$PG_BIN_DIR/createdb" --host="$PG_SOCKET_DIR" --owner="$RESTORE_DB_ROLE" "$RESTORE_DB_NAME"
   "$PG_BIN_DIR/pg_restore" --exit-on-error --no-owner --no-acl \
     --role="$RESTORE_DB_ROLE" \
     --host="$PG_SOCKET_DIR" \
     --dbname="$RESTORE_DB_NAME" \
     "$WORK_DIR/plain/db.dump"
   ```

6. Run deterministic, privacy-safe acceptance checks from the checked-out
   repository (`$REPO_DIR`) against the local Unix-socket database:
   - Verify restored public tables, ownership by `$RESTORE_DB_ROLE`, and row
     counts (`readings`, `notes`).
   - Parse `$WORK_DIR/plain/app.env` in memory for the encryption keyring only
     (never reading or using its production `DATABASE_URL`), load the
     application's `ReadingEncryption` class (`src/readings/reading-encryption.ts`),
     and decrypt one row's `readings.data._enc` (`v3:keyId:iv:tag:ciphertext`
     with AES-256-GCM AAD `[reading, userId, readingId, payload]`) in memory
     without reimplementing crypto or printing payloads.
   - Parse `notes.images` JSON from the restored database, match an exact safe
     `.webp` filename inside `$WORK_DIR/files/uploads/notes` (rejecting symlinks
     and path escapes), and verify the image decodes with the repository's
     `sharp` package.
   - Output **only** counts and booleans—never row values, plaintext readings,
     `.env` secrets, or filenames.

   ```bash
   cd "$REPO_DIR"
   node - \
     "$PG_BIN_DIR" "$PG_SOCKET_DIR" "$RESTORE_DB_NAME" "$RESTORE_DB_ROLE" \
     "$WORK_DIR/plain/app.env" "$WORK_DIR/files/uploads/notes" <<'NODE'
   const { execFileSync } = require("child_process");
   const fs = require("fs");
   const path = require("path");
   const sharp = require("sharp");

   let ReadingEncryption;
   try {
     ({ ReadingEncryption } = require("./dist/src/readings/reading-encryption"));
   } catch {
     require("ts-node/register/transpile-only");
     ({ ReadingEncryption } = require("./src/readings/reading-encryption"));
   }

   const [pgBin, pgSocket, dbName, dbRole, envFile, uploadsNotesDir] = process.argv.slice(2);
   const psqlPath = path.join(pgBin, "psql");
   const notesRoot = fs.realpathSync(uploadsNotesDir);
   if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(dbRole)) {
     throw new Error("Invalid restore role name.");
   }

   function psqlScalar(sql) {
     const out = execFileSync(
       psqlPath,
       ["-X", "-v", "ON_ERROR_STOP=1", "--host", pgSocket, "--dbname", dbName, "-tA", "-c", `SET ROLE ${dbRole}; ${sql}`],
       { encoding: "utf8" }
     );
     return out.trim().split("\n").pop() || "";
   }

   (async () => {
     const tableCount = Number(psqlScalar("SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"));
     const nonOwnerTables = Number(
       psqlScalar(`SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner <> '${dbRole}';`)
     );
     const readingsCount = Number(psqlScalar("SELECT count(*) FROM public.readings;"));
     const notesCount = Number(psqlScalar("SELECT count(*) FROM public.notes;"));
     if (tableCount <= 0 || nonOwnerTables !== 0 || readingsCount <= 0 || notesCount <= 0) {
       throw new Error("Restored table count, ownership, or row count check failed.");
     }

     // Parse only keyring settings from plain/app.env in memory; never read DATABASE_URL.
     const keyringEnv = {};
     for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
       const match = line.match(/^\s*(DATA_ENCRYPTION_[A-Z0-9_]*)\s*=\s*(.*)\s*$/);
       if (match) {
         keyringEnv[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
       }
     }
     delete process.env.DATABASE_URL;
     Object.assign(process.env, keyringEnv);

     const encryption = new ReadingEncryption(
       keyringEnv.DATA_ENCRYPTION_KEYS,
       keyringEnv.DATA_ENCRYPTION_ACTIVE_KEY_ID,
       true
     );

     const readingJson = psqlScalar(
       "SELECT COALESCE((SELECT row_to_json(r)::text FROM public.readings r WHERE r.data ? '_enc' LIMIT 1), '');"
     );
     if (!readingJson) {
       throw new Error("No encrypted reading row found.");
     }
     const readingRow = JSON.parse(readingJson);
     const readingData = typeof readingRow.data === "string" ? JSON.parse(readingRow.data) : readingRow.data;
     const encEnvelope = readingData && readingData._enc;
     if (typeof encEnvelope !== "string") {
       throw new Error("Encrypted reading envelope is missing.");
     }
     const userId = readingRow.userId ?? readingRow.user_id;
     const decrypted = encryption.decryptEnvelope(readingData, userId, readingRow.id);
     const readingDecryptOk = Boolean(decrypted && typeof decrypted === "object" && !("_enc" in decrypted));

     const rawImagesList = JSON.parse(
       psqlScalar("SELECT COALESCE(json_agg(images)::text, '[]') FROM public.notes WHERE images IS NOT NULL;")
     );
     const images = rawImagesList.flatMap((entry) => Array.isArray(entry) ? entry : []);

     let noteImageMapped = false;
     let noteImageOpens = false;
     for (const image of images) {
       const rawName = image && image.filename;
       if (typeof rawName !== "string" || !/^[A-Za-z0-9_-]+\.webp$/.test(rawName)) {
         continue;
       }
       const candidate = path.join(notesRoot, rawName);
       if (!fs.existsSync(candidate) || fs.lstatSync(candidate).isSymbolicLink()) {
         continue;
       }
       const resolved = fs.realpathSync(candidate);
       if (path.dirname(resolved) !== notesRoot || path.basename(resolved) !== rawName) {
         throw new Error("Note image path escaped uploads/notes root.");
       }
       noteImageMapped = true;
       const meta = await sharp(resolved).metadata();
       if (meta.format === "webp" && Number(meta.width) > 0 && Number(meta.height) > 0) {
         noteImageOpens = true;
         break;
       }
     }

     if (!readingDecryptOk || !noteImageMapped || !noteImageOpens) {
       throw new Error("Acceptance verification failed.");
     }

     process.stdout.write(
       `tables_count=${tableCount} non_owner_tables=${nonOwnerTables} ` +
         `readings_count=${readingsCount} notes_count=${notesCount} ` +
         `reading_decrypt_ok=${readingDecryptOk} note_image_mapped=${noteImageMapped} note_image_opens=${noteImageOpens}\n`
     );
   })().catch(() => {
     process.stderr.write("Restore acceptance checks failed.\n");
     process.exit(1);
   });
   NODE
   ```

7. Clean up the temporary database, local PostgreSQL cluster, and `$WORK_DIR` on
   the recovery workstation (also enforced by the `EXIT` trap on failure), and
   confirm `$WORK_DIR` is removed:

   ```bash
   "$PG_BIN_DIR/dropdb" --if-exists --host="$PG_SOCKET_DIR" "$RESTORE_DB_NAME"
   "$PG_BIN_DIR/pg_ctl" -D "$PG_DATA_DIR" -m fast -w stop >/dev/null
   rm -rf -- "$WORK_DIR"
   trap - EXIT
   test ! -e "$WORK_DIR"
   ```

## Production restore

Production restore overwrites live state. The operator must verify the selected
run ID, obtain the incident/change approval required by the organization, and
confirm that the `age` private identity is available on the trusted recovery
workstation before proceeding. Use a root shell (`sudo -i`) with `umask 077` for
the VPS command blocks below.

1. On the VPS, create a randomized root-only staging directory under
   `/var/backups/vinfi` (never under world-writable `/var/tmp`), fetch the
   chosen encrypted run with `--config=/root/.config/rclone/rclone.conf`, and
   verify `SHA256SUMS`. Transfer the encrypted directory to the trusted recovery
   workstation, verify `SHA256SUMS` and decrypt there as described in steps 3–4
   of the verification procedure, then transfer only the decrypted `db.dump`,
   `uploads.tar.gz`, and `app.env` into `$RESTORE_STAGE/plain` on the VPS and
   verify their SHA-256 digests on arrival. Never copy the `age` private
   identity to the VPS.

   ```bash
   set -Eeuo pipefail
   umask 077
   RUN_ID=REPLACE_WITH_SELECTED_RUN_ID
   REMOTE_SUBPATH=daily/YYYY-MM-DD/$RUN_ID

   install -d -o root -g root -m 0700 /var/backups/vinfi
   test -d /var/backups/vinfi && ! test -L /var/backups/vinfi
   RESTORE_STAGE=$(mktemp -d /var/backups/vinfi/.restore-staging.XXXXXX)
   install -d -o root -g root -m 0700 "$RESTORE_STAGE/encrypted" "$RESTORE_STAGE/plain"

   rclone --config=/root/.config/rclone/rclone.conf --log-level ERROR \
     copy "gdrive:vinfi-backup/$REMOTE_SUBPATH" "$RESTORE_STAGE/encrypted"
   if test -f "/var/backups/vinfi/$RUN_ID/SHA256SUMS"; then
     cmp -s "/var/backups/vinfi/$RUN_ID/SHA256SUMS" "$RESTORE_STAGE/encrypted/SHA256SUMS"
   fi
   (cd "$RESTORE_STAGE/encrypted" && sha256sum -c --strict SHA256SUMS)
   ```

2. Stop the vInfiSSO process (`pm2 stop vinfi-sso`; verify the configured PM2
   process name before running the command). Take a fresh encrypted backup of
   the current database and uploads before replacing them, if the current state
   remains accessible.
3. Restore PostgreSQL. Confirm that the `vinfi_sso` database role exists and
   owns or can create the application objects. `--clean --if-exists` drops
   objects in the target database; `--role=vinfi_sso` makes the restored
   objects owned by the application role instead of `postgres`. Stream `db.dump`
   via root standard input so `$RESTORE_STAGE/plain` remains mode `0700` owned
   by `root:root`.

   ```bash
   sudo -u postgres pg_restore --exit-on-error --clean --if-exists --no-owner \
     --role=vinfi_sso \
     --dbname=vinfi_sso < "$RESTORE_STAGE/plain/db.dump"
   ```

4. Replace uploads reversibly. Set `APP_ROOT`, `RUN_ID`, `APP_OWNER`, and
   `APP_GROUP` to the verified deployment path, selected run ID, and runtime
   account. Validate archive entry types and paths to reject links or traversal
   entries, extract a second copy on the app filesystem, then swap the directory
   names so the old directory remains available for rollback:

   ```bash
   APP_ROOT=/var/www/sso.vunph.click
   RUN_ID=REPLACE_WITH_SELECTED_RUN_ID
   APP_OWNER=REPLACE_WITH_RUNTIME_USER
   APP_GROUP=REPLACE_WITH_RUNTIME_GROUP
   test ! -e "$APP_ROOT/uploads.pre-restore.$RUN_ID"
   sudo install -d -o root -g root -m 0700 "$APP_ROOT/.restore-staging/$RUN_ID"

   tar -tvzf "$RESTORE_STAGE/plain/uploads.tar.gz" \
     | awk 'NR == 0 { bad=1 } $1 !~ /^[-d][rwxstST-]{9}$/ { bad=1 } END { if (NR == 0) bad=1; exit bad }' \
     || { printf 'Archive entry-type validation failed (links or special files rejected).\n' >&2; exit 1; }
   tar -tzf "$RESTORE_STAGE/plain/uploads.tar.gz" \
     | awk 'NR == 0 { bad=1 } $0 !~ /^uploads(\/|$)/ || $0 ~ /(^|\/)\.\.(\/|$)/ || $0 ~ /^\// { bad=1 } END { if (NR == 0) bad=1; exit bad }' \
     || { printf 'Archive path validation failed.\n' >&2; exit 1; }

   sudo tar -xzf "$RESTORE_STAGE/plain/uploads.tar.gz" \
     -C "$APP_ROOT/.restore-staging/$RUN_ID" --no-same-owner --no-same-permissions
   test -z "$(sudo find "$APP_ROOT/.restore-staging/$RUN_ID" \( -type l -o \( ! -type f ! -type d \) \) -print -quit)" \
     || { printf 'Post-extraction file-type validation failed.\n' >&2; exit 1; }

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
     "$RESTORE_STAGE/plain/app.env" "$APP_ROOT/.env.restore.$RUN_ID"
   sudo mv "$APP_ROOT/.env.restore.$RUN_ID" "$APP_ROOT/.env"
   ```

6. Start the application with the code version compatible with the restored DB
   schema. Check service health, SSO login, a reading read/decrypt, and a note
   image. Keep the old database, uploads, and env backups until recovery is
   accepted. If validation fails, stop the service and restore the previous
   database, uploads, and env as a matched set.
7. Remove temporary plaintext staging (`$RESTORE_STAGE`),
   `$APP_ROOT/.restore-staging/$RUN_ID`, and the recovery workstation's
   temporary restore directory only after recovery is complete. The `age`
   private identity must never be copied to the VPS or duplicated into temporary
   working copies during restore; preserve the protected offline identity on the
   recovery workstation. Use the system's approved secure deletion or
   encrypted-volume disposal process; do not leave decrypted dumps or `.env`
   copies in the repository or Drive.

   ```bash
   sudo rm -rf -- "$RESTORE_STAGE" "$APP_ROOT/.restore-staging/$RUN_ID"
   ```

## Recovery objectives and ownership

- Target RPO: 24 hours, assuming the daily backup completed.
- Target RTO: under 1 hour for a healthy VPS and a verified restore set.
- The service owner is responsible for checking the daily cron result and
  monthly restore drill. A green upload alone is not a restore test.
- Keep the age private identity and production reading-encryption keyring in
  separate protected recovery locations. The server should retain only the age
  public recipient and the encrypted backups.

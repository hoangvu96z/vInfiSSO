#!/usr/bin/env bash
# Encrypted, offsite backup for the vInfiSSO PostgreSQL database, uploads, and
# server-only environment file. Intended to run from root's daily cron on Linux.
set -Eeuo pipefail
umask 077

readonly DEFAULT_CONFIG_FILE=/etc/vinfi-backup.conf
readonly CONFIG_FILE="${BACKUP_CONFIG_FILE:-$DEFAULT_CONFIG_FILE}"
readonly LOCK_FILE=/run/lock/vinfi-backup.lock
MODE=run

usage() {
  cat <<'EOF'
Usage: backup-vinfi.sh [--dry-run] [--help]

--dry-run  Validate configuration and print the planned actions. Does not read
           backup contents, connect to PostgreSQL/Google Drive, or create files.
--help     Show this help.

The root-only configuration file is /etc/vinfi-backup.conf. Set
BACKUP_CONFIG_FILE only when validating a separate configuration.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE=dry-run ;;
    --help) usage; exit 0 ;;
    *) printf 'Unknown option. Use --help for usage.\n' >&2; exit 2 ;;
  esac
done

fail() {
  printf 'Backup configuration error: %s\n' "$1" >&2
  exit 2
}

file_owner_and_mode() {
  local path=$1
  if stat -c '%u %a' -- "$path" >/dev/null 2>&1; then
    stat -c '%u %a' -- "$path"
  else
    stat -f '%u %Lp' "$path"
  fi
}

[[ -f "$CONFIG_FILE" && ! -L "$CONFIG_FILE" ]] || fail "config file is missing or not a regular file"
config_stat=$(file_owner_and_mode "$CONFIG_FILE") || fail "cannot inspect config file permissions"
read -r config_owner config_mode <<<"$config_stat"
[[ "$config_mode" =~ ^[0-7]{3,4}$ ]] || fail "cannot read config file permissions"
config_mode_value=$((8#$config_mode))
(( (config_mode_value & 077) == 0 )) || fail "config file must not be accessible to group or other users"
if (( EUID == 0 )); then
  [[ "$config_owner" == 0 ]] || fail "root-run config file must be owned by root"
elif [[ "$MODE" == run ]]; then
  fail "backup must run as root"
else
  [[ "$config_owner" == "$EUID" ]] || fail "dry-run config must be owned by the current user"
fi

# Read only simple KEY=value assignments; never execute the configuration.
# Values intentionally cannot contain shell syntax, whitespace, or expansions.
while IFS= read -r config_line || [[ -n "$config_line" ]]; do
  [[ "$config_line" =~ ^[[:space:]]*(#.*)?$ ]] && continue
  if [[ "$config_line" =~ ^([A-Z_][A-Z0-9_]*)=([A-Za-z0-9_./:-]+)$ ]]; then
    setting_name=${BASH_REMATCH[1]}
    setting_value=${BASH_REMATCH[2]}
  else
    fail "config file must contain only simple KEY=value assignments"
  fi
  case "$setting_name" in
    BACKUP_APP_ROOT|BACKUP_ENV_FILE|BACKUP_UPLOADS_PATH|BACKUP_DATABASE_NAME|\
    BACKUP_POSTGRES_OS_USER|BACKUP_LOCAL_ROOT|BACKUP_RCLONE_REMOTE|\
    BACKUP_RCLONE_CONFIG|BACKUP_AGE_RECIPIENT) ;;
    *) fail "config file contains an unsupported setting name" ;;
  esac
  printf -v "$setting_name" '%s' "$setting_value"
done < "$CONFIG_FILE"

require_setting() {
  local name=$1
  [[ -n "${!name:-}" ]] || fail "$name is required"
}

for setting in \
  BACKUP_APP_ROOT \
  BACKUP_ENV_FILE \
  BACKUP_UPLOADS_PATH \
  BACKUP_DATABASE_NAME \
  BACKUP_POSTGRES_OS_USER \
  BACKUP_LOCAL_ROOT \
  BACKUP_RCLONE_REMOTE \
  BACKUP_RCLONE_CONFIG \
  BACKUP_AGE_RECIPIENT; do
  require_setting "$setting"
done

[[ "$BACKUP_APP_ROOT" == /* && "$BACKUP_APP_ROOT" != "/" ]] || fail "app root must be an absolute non-root path"
[[ -d "$BACKUP_APP_ROOT" && ! -L "$BACKUP_APP_ROOT" ]] || fail "app root must be an existing non-symlink directory"
[[ -f "$BACKUP_ENV_FILE" && -r "$BACKUP_ENV_FILE" && ! -L "$BACKUP_ENV_FILE" ]] || fail "server env file must be a readable regular file"
[[ "$BACKUP_ENV_FILE" == "$BACKUP_APP_ROOT/.env" ]] || fail "server env file must be the app root .env file"
env_stat=$(file_owner_and_mode "$BACKUP_ENV_FILE") || fail "cannot inspect server env file permissions"
read -r _env_owner env_mode <<<"$env_stat"
[[ "$env_mode" =~ ^[0-7]{3,4}$ ]] || fail "cannot read server env file permissions"
env_mode_value=$((8#$env_mode))
(( (env_mode_value & 077) == 0 )) || fail "server env file must not be accessible to group or other users"
[[ -d "$BACKUP_APP_ROOT/$BACKUP_UPLOADS_PATH" && ! -L "$BACKUP_APP_ROOT/$BACKUP_UPLOADS_PATH" ]] || fail "uploads path must be an existing non-symlink directory under app root"
[[ "$BACKUP_UPLOADS_PATH" != /* && ! "$BACKUP_UPLOADS_PATH" =~ (^|/)\.\.(/|$) && "$BACKUP_UPLOADS_PATH" != "." ]] || fail "uploads path must be relative and must not traverse parent directories"
[[ "$BACKUP_DATABASE_NAME" =~ ^[A-Za-z0-9_-]+$ ]] || fail "database name has unsupported characters"
[[ "$BACKUP_POSTGRES_OS_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || fail "PostgreSQL OS user has unsupported characters"
[[ "$BACKUP_AGE_RECIPIENT" =~ ^age1[A-Za-z0-9]+$ ]] || fail "age recipient must be a public age1 recipient"
[[ "$BACKUP_LOCAL_ROOT" == /* && "$BACKUP_LOCAL_ROOT" != "/" ]] || fail "local backup root must be an absolute non-root path"
[[ "${BACKUP_LOCAL_ROOT##*/}" == vinfi && ! "$BACKUP_LOCAL_ROOT" =~ (^|/)\.\.(/|$) ]] || fail "local backup root must be a dedicated directory named vinfi"
[[ "$BACKUP_LOCAL_ROOT" != "$BACKUP_APP_ROOT" && "$BACKUP_LOCAL_ROOT" != "$BACKUP_APP_ROOT/"* ]] || fail "local backup root must be outside the application tree"

[[ -f "$BACKUP_RCLONE_CONFIG" && -r "$BACKUP_RCLONE_CONFIG" && ! -L "$BACKUP_RCLONE_CONFIG" ]] || fail "rclone config must be a readable regular file"
rclone_stat=$(file_owner_and_mode "$BACKUP_RCLONE_CONFIG") || fail "cannot inspect rclone config permissions"
read -r rclone_owner rclone_mode <<<"$rclone_stat"
[[ "$rclone_mode" =~ ^[0-7]{3,4}$ ]] || fail "cannot read rclone config permissions"
rclone_mode_value=$((8#$rclone_mode))
(( (rclone_mode_value & 077) == 0 )) || fail "rclone config must not be accessible to group or other users"
if (( EUID == 0 )); then
  [[ "$rclone_owner" == 0 ]] || fail "root-run rclone config must be owned by root"
else
  [[ "$rclone_owner" == "$EUID" ]] || fail "dry-run rclone config must be owned by the current user"
fi

[[ "$BACKUP_RCLONE_REMOTE" =~ ^[A-Za-z0-9_-]+:[^[:space:]]+$ ]] || fail "rclone destination must be a named remote and non-empty path"
remote_path=${BACKUP_RCLONE_REMOTE#*:}
[[ "$remote_path" != "/" && ! "$remote_path" =~ (^|/)\.\.(/|$) ]] || fail "rclone destination must not be a root or parent-traversal path"
[[ "${remote_path%/}" == vinfi-backup || "${remote_path%/}" == */vinfi-backup ]] || fail "rclone destination must be a dedicated vinfi-backup directory"

for command_name in age chmod date find flock mkdir mktemp mv pg_dump rm rclone runuser sha256sum stat tar; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is unavailable: $command_name"
done

if [[ "$MODE" == dry-run ]]; then
  run_id=$(date -u +%Y-%m-%dT%H%M%SZ)
  run_date=${run_id%%T*}
  printf 'Local configuration checks passed. No backup data was read and no remote service was contacted.\n'
  printf 'This did not verify age recipient validity, PostgreSQL access, or Drive access.\n'
  printf 'Would encrypt PostgreSQL database %s, %s, and the configured server env file.\n' \
    "$BACKUP_DATABASE_NAME" "$BACKUP_UPLOADS_PATH"
  printf 'Would store locally under %s/%s and upload to %s/daily/%s/%s.\n' \
    "$BACKUP_LOCAL_ROOT" "$run_id" "${BACKUP_RCLONE_REMOTE%/}" "$run_date" "$run_id"
  printf 'Would retain local backups for 7 days, daily Drive backups for 30 days, and monthly Drive backups for 365 days.\n'
  exit 0
fi

(( EUID == 0 )) || fail "backup must run as root"

RUN_ID=$(date -u +%Y-%m-%dT%H%M%SZ)
RUN_DATE=${RUN_ID%%T*}
RUN_MONTH=${RUN_DATE:0:7}
FINAL_DIR="$BACKUP_LOCAL_ROOT/$RUN_ID"
TEMP_DIR=""
REMOTE_BASE=${BACKUP_RCLONE_REMOTE%/}
REMOTE_DAILY="$REMOTE_BASE/daily/$RUN_DATE/$RUN_ID"

on_error() {
  local status=$?
  printf 'Backup failed at script line %s (exit %s). Completed local artifacts, if any, were kept; no command arguments or file contents were logged.\n' \
    "$1" "$status" >&2
  exit "$status"
}
cleanup() {
  trap - ERR
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR" 2>/dev/null || true
  fi
}
trap 'on_error "$LINENO"' ERR
trap cleanup EXIT

[[ ! -L "$LOCK_FILE" ]] || fail "backup lock file must not be a symlink"
exec 9>>"$LOCK_FILE"
chmod 600 "$LOCK_FILE"
flock -n 9 || fail "another backup is already running"

if [[ -e "$BACKUP_LOCAL_ROOT" && ( ! -d "$BACKUP_LOCAL_ROOT" || -L "$BACKUP_LOCAL_ROOT" ) ]]; then
  fail "local backup root must be a non-symlink directory"
fi
mkdir -p -m 700 -- "$BACKUP_LOCAL_ROOT"
chmod 700 "$BACKUP_LOCAL_ROOT"
[[ ! -e "$FINAL_DIR" ]] || fail "backup destination already exists"
TEMP_DIR=$(mktemp -d "$BACKUP_LOCAL_ROOT/.${RUN_ID}.XXXXXX")
chmod 700 "$TEMP_DIR"

# Plaintext flows directly from each source into age; it is never written to a
# temporary file. The local and Drive copies contain only ciphertext and hashes.
runuser -u "$BACKUP_POSTGRES_OS_USER" -- pg_dump --no-password \
  --host=/var/run/postgresql -Fc --no-owner --dbname="$BACKUP_DATABASE_NAME" \
  | age -r "$BACKUP_AGE_RECIPIENT" -o "$TEMP_DIR/db.dump.age"

tar -C "$BACKUP_APP_ROOT" -czf - -- "$BACKUP_UPLOADS_PATH" \
  | age -r "$BACKUP_AGE_RECIPIENT" -o "$TEMP_DIR/uploads.tar.gz.age"

age -r "$BACKUP_AGE_RECIPIENT" -o "$TEMP_DIR/app.env.age" "$BACKUP_ENV_FILE"
(cd "$TEMP_DIR" && sha256sum db.dump.age uploads.tar.gz.age app.env.age) \
  > "$TEMP_DIR/SHA256SUMS"
chmod 600 "$TEMP_DIR"/*
mv -- "$TEMP_DIR" "$FINAL_DIR"
TEMP_DIR=""
chmod 700 "$FINAL_DIR"

rclone --non-interactive --config "$BACKUP_RCLONE_CONFIG" --log-level ERROR \
  copy "$FINAL_DIR" "$REMOTE_DAILY"
rclone --non-interactive --config "$BACKUP_RCLONE_CONFIG" --log-level ERROR \
  check --one-way "$FINAL_DIR" "$REMOTE_DAILY"

if [[ "${RUN_DATE:8:2}" == 01 ]]; then
  REMOTE_MONTHLY="$REMOTE_BASE/monthly/$RUN_MONTH/$RUN_ID"
  rclone --non-interactive --config "$BACKUP_RCLONE_CONFIG" --log-level ERROR \
    copy "$FINAL_DIR" "$REMOTE_MONTHLY"
  rclone --non-interactive --config "$BACKUP_RCLONE_CONFIG" --log-level ERROR \
    check --one-way "$FINAL_DIR" "$REMOTE_MONTHLY"
fi

# Retention runs only after the new copy has uploaded and passed rclone check.
rclone --non-interactive --config "$BACKUP_RCLONE_CONFIG" --log-level ERROR \
  delete "$REMOTE_BASE/daily" --min-age 30d
rclone --non-interactive --config "$BACKUP_RCLONE_CONFIG" --log-level ERROR \
  rmdirs "$REMOTE_BASE/daily"
rclone --non-interactive --config "$BACKUP_RCLONE_CONFIG" --log-level ERROR \
  delete "$REMOTE_BASE/monthly" --min-age 365d
rclone --non-interactive --config "$BACKUP_RCLONE_CONFIG" --log-level ERROR \
  rmdirs "$REMOTE_BASE/monthly"

find "$BACKUP_LOCAL_ROOT" -mindepth 1 -maxdepth 1 -type d \
  -name '????-??-??T??????Z' -mtime +6 -exec rm -rf -- {} +

printf 'Backup complete: run_id=%s\n' "$RUN_ID"

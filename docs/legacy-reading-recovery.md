# Offline legacy reading recovery

This utility reads one user's legacy `enc_v1::` readings from a restored local
PostgreSQL copy and writes a sidecar containing V3 server-encrypted envelopes.
It never updates the database. Applying the sidecar is a separate operation and
is not part of this command.

## Required inputs

- A PostgreSQL backup restored into a separate local database named with the
  `_recovery` or `_restore` suffix (for example, `vinfi_sso_recovery`). Keep the
  restored database offline from production. The tool rejects non-`localhost`
  URLs, other database names, and a server address that is not loopback.
- The exact owner UUID for the candidate key.
- A local file containing only the historical 32-byte AES key as 64 hex
  characters, optionally followed by a newline. It must be owned by the current
  user and have no group/world permissions (`chmod 600`). This matches the
  original browser `vinfi_e2ee_key_<userId>` value.
- The `DATA_ENCRYPTION_KEYS` and `DATA_ENCRYPTION_ACTIVE_KEY_ID` values required
  to create V3 envelopes. Supply these and `RECOVERY_DATABASE_URL` through a
  protected runtime environment. The utility does not load `.env` files.
- For a PostgreSQL instance bound to a Unix socket, optionally supply
  `RECOVERY_DATABASE_SOCKET_DIR` in that protected runtime environment. The
  socket directory must be absolute, owned by the current user, and have no
  group/world permissions. The URL still uses `localhost` and the restored
  database's local port; the utility connects through the socket directory.
- A new absolute output path whose parent directory already exists. The output
  must not already exist; it is created with mode `0600`.

If the backup archive or the server encryption configuration is age-encrypted,
decrypt it locally with the separately held age identity before starting the
utility. Do not pass any key material as command-line arguments.

## Run

Build the backend first, with the recovery environment variables available only
to the local process through the user's secure environment mechanism:

```sh
npm run build
npm run recover:legacy:readings -- \
  --user-id=<owner-uuid> \
  --key-file=/absolute/private/path/legacy-key.hex \
  --output-file=/absolute/private/path/recovered-readings.json
```

The command prints only aggregate counts and whether it created an artifact. If
any candidate row fails authentication or payload validation, it writes no
artifact. The sidecar contains row identifiers and metadata plus V3 encrypted
payloads; it does not contain plaintext reading fields. Keep it private and do
not commit or upload it.

## Safety limits

- The database connection runs with PostgreSQL read-only transactions and
  `synchronize`/migrations disabled.
- The command accepts only a local `_recovery`/`_restore` database. Never point
  it at production.
- It never deletes rows, resets a database, or applies recovered rows.
- Tests use synthetic keys and synthetic reading payloads only.

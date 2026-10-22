# 📋 vInfiSSO Deployment Quick Reference

## 🎯 Deployment for: sso.vunph.click

---

## 📝 Step-by-Step Checklist

### Phase 1: VPS Setup (One-time)
- [ ] SSH into VPS
- [ ] Run: `bash setup-vps.sh` (auto-setup all dependencies)
- [ ] Or manually run commands from DEPLOYMENT_GUIDE.md

### Phase 2: Database Setup
```bash
sudo -u postgres psql
postgres=# CREATE USER vinfi_sso WITH PASSWORD 'STRONG_PASSWORD';
postgres=# CREATE DATABASE vinfi_sso OWNER vinfi_sso;
postgres=# \q
```

### Phase 3: SSL Certificate
```bash
sudo certbot certonly --standalone -d sso.vunph.click
```

### Phase 4: Configure Mail Server
```bash
sudo nano /etc/postfix/main.cf
# Update: myhostname = sso.vunph.click, mydomain = vunph.click
sudo systemctl restart postfix
```

### Phase 5: Deploy Application
```bash
cd /opt/vinfisso
git clone https://github.com/hoangvu96z/vInfiSSO.git .
npm install
npm run build
```

The deploy workflow runs on push, uploads the compiled release, and restarts
PM2 without a migration approval pause. Use two releases for every schema
change:

1. Push a migration-only or backward-compatible release containing the
   migration and CLI, but no application code that requires the new schema.
   Wait for its Deploy Action and health check to succeed.
2. Take and verify the encrypted database backup, including its offsite copy.
   On the VPS, review and apply the migration from the deployed release.
3. Only after the final `migration:show` confirms the expected state, push the
   application release that depends on the migrated schema.

```bash
# Run after the migration-capable release deployed successfully and before
# pushing/deploying application code that depends on this schema.
# First take and verify the encrypted, offsite database backup.
cd /var/www/sso.vunph.click

# Read-only gate for the AI quota uniqueness migration. Stop if the duplicate
# group count is nonzero. The migration repeats this check and fails without
# changing rows if duplicates exist when it runs.
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d vinfi_sso <<'SQL'
SELECT COUNT(*) AS duplicate_key_groups
FROM (
  SELECT 1
  FROM public.ai_usage
  GROUP BY "userId", date, app
  HAVING COUNT(*) > 1
) AS duplicate_groups;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'ai_usage'
  AND indexdef ILIKE 'CREATE UNIQUE INDEX%';
SQL

# Review pending migrations. Stop if the list differs from the approved plan.
NODE_ENV=production npm run migration:show

# Apply only the reviewed migrations with a database role allowed to run DDL.
NODE_ENV=production npm run migration:run

# Verify the expected migration state before pushing the dependent release.
NODE_ENV=production npm run migration:show
```

The TypeORM CLI uses `DATABASE_*` settings from the server environment files.
Run it from `/var/www/sso.vunph.click`; the compiled DataSource loads `.env` and
`.env.production` from that working directory without printing their contents.
Each push deploys and restarts automatically. Do not put schema-dependent app
code in the migration-capable release; deploy that code in the second release,
after the manual migration succeeds.
If the runtime database role cannot create schema objects, provide the
`MIGRATION_DATABASE_*` overrides only in the operator's secure shell environment;
do not store those elevated credentials in the repository or application `.env`.
The existing coupon migration was previously applied as manual SQL. Its TypeORM
version is idempotent, so running it once through the CLI safely records it in
`typeorm_migrations` and reapplies the grants without duplicating redemptions.
The `ai_usage` quota-index migration is also guarded: it checks for duplicate
`("userId", date, app)` groups and aborts before creating the index if any are
present. Do not delete or merge duplicate usage rows automatically; stop and
review them under an approved data procedure. The pre-deploy query above is an
operator review gate; confirm whether `IDX_72dc538b954157b0ed930f9f19` already
has the expected definition. The migration validates that canonical index name
against PostgreSQL's catalog and protects against changes after the review.

`synchronize` and `migrationsRun` remain disabled in the application, and GitHub
Actions does not run database DDL. Migration review and execution are explicit
operator steps between the migration-capable release and the schema-dependent
application release. Use expand/contract across releases for destructive
changes: expand with backward-compatible schema first, move application use in
a later release, and remove old schema only in a subsequent release after no
deployed code depends on it.

### Reading envelope migration (v1/v2 to v3)

New readings are stored as v3 envelopes authenticated with the user ID, reading
UUID, and the explicit `payload` field name. The API continues to read existing
v2 envelopes with their original user-only AAD and legacy client-encrypted
records. This migration rewrites encrypted `readings.data` values only; it does
not change the database schema. The CLI reports counts only and never exports
decrypted reading content.

Before a production apply, follow `RUNBOOK_RESTORE.md`, complete a restore drill
from an encrypted offsite backup including reading decryption, and create a
fresh encrypted offsite backup with `/usr/local/sbin/backup-vinfi.sh`. Verify
its status and checksums before proceeding; a successful upload alone is not
enough. Deploy the v3-capable API
first. The build emits `dist/scripts/encrypt-readings.js`; the deploy workflow
checks for and uploads that compiled entry point with the release. The CLI runs
with Node and production dependencies only; it does not require the TypeScript
source or `ts-node` on the VPS. Verify the deployed artifact exists before
running it. New v3 writes are readable alongside existing v2/legacy rows, so
the API may serve traffic during a migration dry-run. With no known exceptions,
the dry-run must finish with zero `legacyDecryptionFailed` and be reviewed before
any write:

```bash
cd /var/www/sso.vunph.click
NODE_ENV=production npm run encrypt:readings -- --dry-run
```

If a reviewed inventory contains legacy ciphertext that cannot be authenticated
with any retained legacy key, do not use a blanket skip option. Put exactly the
approved reading IDs, one per line, in a caller-provided file outside the
repository. The file must be a regular file owned by the operator running the
CLI with no group or world permissions; mode `0600` is recommended and `0400`
is also accepted. Blank lines are ignored. The CLI never prints IDs or record
contents. The exact-ID mode runs a no-write preflight and requires the
unreadable legacy ID set to equal the file contents. It rejects extra failures,
missing IDs, duplicate IDs, and insecure files. Review the summary counts and
use the same protected file for every dry-run/apply check:

```bash
# Prepare this file outside the repository as the same OS user that will run
# the CLI; enter one approved reading ID per line with a secure local editor.
EXPECTED_IDS_FILE=/home/ubuntu/.private/reading-unreadable-ids.txt
chmod 600 "$EXPECTED_IDS_FILE"
NODE_ENV=production npm run encrypt:readings -- --dry-run --expected-unreadable-legacy-ids-file="$EXPECTED_IDS_FILE"
```

If the dry-run passes its configured policy, stop `vinfi-sso` to prevent
concurrent reading writes, then apply the migration. For the exact-ID mode,
repeat the dry-run after the service is stopped, then apply using the same
allowlist. Preflight and all bounded batches run in one `SERIALIZABLE`
transaction with row locks; if the failed-ID set differs from the allowlist
during apply, the transaction aborts without committing any batch. If this
controlled apply fails, keep the service stopped, rerun dry-run, and investigate
before changing the private allowlist or retrying. Without an allowlist, the
default apply also validates all records before writing, then commits bounded
batches of at most 200 records. If a default apply stops midway, the deployed
API can read the resulting mix of v2 and v3; rerun the dry-run, review its
counts, then resume before restarting the API.

```bash
EXPECTED_IDS_FILE=/home/ubuntu/.private/reading-unreadable-ids.txt
pm2 stop vinfi-sso && \
  NODE_ENV=production npm run encrypt:readings -- --dry-run --expected-unreadable-legacy-ids-file="$EXPECTED_IDS_FILE" && \
  NODE_ENV=production npm run encrypt:readings -- --apply --expected-unreadable-legacy-ids-file="$EXPECTED_IDS_FILE" && \
  NODE_ENV=production npm run encrypt:readings -- --dry-run --expected-unreadable-legacy-ids-file="$EXPECTED_IDS_FILE" && \
  pm2 restart vinfi-sso --update-env
```

Run the chain as one block. If it returns a failure after stopping the service,
leave `vinfi-sso` stopped and investigate; the restart is reached only after
both dry-runs and the apply succeed.

After a normal apply, the dry-run must report `eligible: 0`,
`legacyDecryptionFailed: 0`, and all migrated records as `alreadyCurrent`. With
the exact-ID exception file, the post-apply dry-run must report `eligible: 0`,
`legacyPreserved` and `legacyDecryptionFailed` equal to the allowlist count, and
must match that same ID set exactly. Verify the API and a reading can be fetched
and decrypted before accepting the release. Keep the verified pre-migration
backup until acceptance.

For an application rollback to a v2-only release, use the deployed migration
CLI to downgrade every v3 envelope to v2 while preserving the current database
rows. A v2-only release cannot read v3 rows, including v3 rows created before
the backfill finishes. Run a dry-run, stop `vinfi-sso`, run the dry-run again,
then apply and run the dry-run once more. Only deploy/resume the old application
after the final report shows `eligible: 0` and `legacyDecryptionFailed: 0`.
V2/legacy reads remain compatible with the current release throughout this
step; legacy ciphertext rows are preserved unchanged and appear in
`legacyPreserved`. This preserves readings created by the v3 release, including
records written before or during the v2-to-v3 backfill. Keep the service stopped until
the v2-only release takes over, so no new v3 rows are written. Do not restore
the old pre-migration database for an application-only rollback, since that
would discard newer readings. Use the full verified backup only for database
recovery, and never manually edit envelopes or use `--reencrypt` as a rollback.

```bash
cd /var/www/sso.vunph.click
NODE_ENV=production npm run encrypt:readings -- --rollback-to-v2 --dry-run && \
  pm2 stop vinfi-sso && \
  NODE_ENV=production npm run encrypt:readings -- --rollback-to-v2 --dry-run && \
  NODE_ENV=production npm run encrypt:readings -- --rollback-to-v2 --apply && \
  NODE_ENV=production npm run encrypt:readings -- --rollback-to-v2 --dry-run
# Now deploy/revert the application to the v2-only release and let its deploy
# restart PM2. Do not restart the v3 release between conversion and rollback.
```

Run the rollback chain as one block. If it returns a failure after stopping
the service, keep the service stopped and do not deploy the v2-only release
until the failure is resolved and the final rollback dry-run succeeds.

### Phase 6: Configure Environment
```bash
# Copy production .env
cp .env.production .env

# Edit with real values
nano .env
# Update: DATABASE_PASSWORD, JWT_SECRET, SESSION_SECRET, OAUTH credentials
```

### Phase 7: Start Application
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Phase 8: Setup Nginx Reverse Proxy
```bash
# Copy config template
sudo nano /etc/nginx/sites-available/vinfisso
# Update SSL paths
sudo ln -s /etc/nginx/sites-available/vinfisso /etc/nginx/sites-enabled/
sudo systemctl restart nginx
```

---

## 🔑 Required Environment Variables

```env
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=vinfi_sso
DATABASE_PASSWORD=YOUR_SECURE_PASSWORD

# JWT
JWT_SECRET=GENERATE_WITH: openssl rand -hex 32
# Keep stable across SSO instances and deployments while rotated sessions are active.
SESSION_SECRET=REPLACE_WITH_OUTPUT_OF_openssl_rand_hex_32

# Email (using local Postfix)
MAIL_HOST=localhost
MAIL_PORT=25
MAIL_USER=
MAIL_PASSWORD=
MAIL_FROM=noreply@vunph.click

# OAuth (get from Google Cloud Console & Facebook Developer)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://sso.vunph.click/sso/oauth/google/callback

FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_CALLBACK_URL=https://sso.vunph.click/sso/oauth/facebook/callback

# URLs
SSO_BASE_URL=https://sso.vunph.click
ICHINGNOW_URL=https://vunph.click/kinhdich
TAROTNOW_URL=https://vunph.click/tarot

# CORS
ALLOWED_ORIGINS=https://vunph.id.vn,https://www.vunph.id.vn,https://vunph.click,https://www.vunph.click
ALLOWED_REDIRECT_ORIGINS=https://vunph.id.vn,https://www.vunph.id.vn
APP_BASE_URL=https://vunph.click
TRUST_PROXY=loopback
```

---

## 🔧 Common Commands

### View Logs
```bash
pm2 logs vinfisso          # Application logs
sudo tail -f /var/log/mail.log  # Mail server logs
```

### Restart Services
```bash
pm2 restart vinfisso       # Restart app
sudo systemctl restart postfix      # Restart mail
sudo systemctl restart nginx        # Restart web server
```

### Deploy Updates
```bash
cd /opt/vinfisso
git pull
npm install
npm run build
pm2 restart vinfisso
```

### Check Status
```bash
pm2 status
pm2 monit
sudo systemctl status postfix
sudo systemctl status nginx
```

---

## 🚨 Troubleshooting

| Issue | Solution |
|-------|----------|
| App won't start | Check logs: `pm2 logs vinfisso` |
| Database error | Test: `psql -U vinfi_sso -h localhost -d vinfi_sso` |
| Emails not sending | Check: `sudo tail -f /var/log/mail.log` |
| SSL certificate error | Renew: `sudo certbot renew` |
| Nginx error | Test: `sudo nginx -t` |
| Port 3000 in use | Kill: `sudo lsof -i :3000` then `kill -9 <PID>` |

---

## 📊 Monitoring

```bash
# CPU/Memory usage
top

# Disk space
df -h

# Active connections
sudo netstat -tlnp

# Mail queue
sudo postqueue -p

# SSL certificate expiry
sudo certbot certificates
```

---

## 🔐 Security Checklist

Before going live:
- [ ] Strong passwords set (DATABASE_PASSWORD, JWT_SECRET, SESSION_SECRET)
- [ ] SSL certificate installed and auto-renew enabled
- [ ] Firewall rules configured (allow only 22, 80, 443, 25)
- [ ] SSH key-based auth enabled, password auth disabled
- [ ] Encrypted backups scheduled and verified (see `docs/backup-restore.md`)
- [ ] Log rotation configured
- [ ] All environment variables secured
- [ ] OAuth credentials are correct

---

## Encrypted backup commands

```bash
# Validate backup configuration without reading the database
sudo /usr/local/sbin/backup-vinfi.sh --dry-run

# Create the encrypted backup and inspect its status
sudo /usr/local/sbin/backup-vinfi.sh
sudo cat /var/backups/vinfi/status.json
```

Use `docs/backup-restore.md` for installation, offsite setup, retention, and
restore instructions. Do not write plaintext database dumps to disk.

---

## 📞 Support

Check these files for more details:
- `DEPLOYMENT_GUIDE.md` - Full deployment instructions
- `MAIL_SERVER_SETUP.md` - Mail server configuration
- `setup-vps.sh` - Automated setup script
- `.env.production` - Production environment template

---

**Last Updated**: 2026-07-21  
**Status**: Ready for deployment to sso.vunph.click ✅

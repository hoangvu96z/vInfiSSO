# 🚀 vInfiSSO Production Deployment Guide

## 📍 Deployment Target
- **URL**: https://sso.vunph.click
- **VPS**: Linux (Ubuntu 20.04+)
- **Mail Server**: Postfix on same VPS

---

## 🔧 Pre-Deployment Setup on VPS

### 1. Install Dependencies
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 22.13 or later
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install nodejs -y
node --version # Must be v22.13.0 or later

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib -y

# Install Postfix (Mail Server)
sudo apt install postfix -y
# Select: Internet Site
# Mail name: vunph.click
```

### 2. Create PostgreSQL Database
```bash
sudo -u postgres psql
postgres=# CREATE USER vinfi_sso WITH PASSWORD 'CHANGE_ME_SECURE_PASSWORD';
postgres=# CREATE DATABASE vinfi_sso OWNER vinfi_sso;
postgres=# GRANT ALL PRIVILEGES ON DATABASE vinfi_sso TO vinfi_sso;
postgres=# \q
```

### 3. Setup Postfix for Local Mail
```bash
# Configure Postfix
sudo nano /etc/postfix/main.cf
```

Find and update:
```ini
# Around line 80-100
myhostname = sso.vunph.click
mydomain = vunph.click
myorigin = $mydomain
mynetworks = 127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128

# Allow larger emails (around line 25)
message_size_limit = 102400000
mailbox_size_limit = 0
```

Restart Postfix:
```bash
sudo systemctl restart postfix
sudo systemctl enable postfix  # Auto-start on boot
```

### 4. Setup Firewall
```bash
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP
sudo ufw allow 443/tcp    # HTTPS
sudo ufw allow 25/tcp     # SMTP
sudo ufw enable
```

### 5. Setup SSL Certificate (Let's Encrypt)
```bash
sudo apt install certbot python3-certbot-nginx -y

# For standalone (without web server)
sudo certbot certonly --standalone -d sso.vunph.click

# Or if using Nginx
sudo certbot --nginx -d sso.vunph.click
```

### 6. Setup Application Directory
```bash
# Create app directory
sudo mkdir -p /opt/vinfisso
sudo chown $USER:$USER /opt/vinfisso
cd /opt/vinfisso

# Clone repository (or upload files)
git clone https://github.com/hoangvu96z/vInfiSSO.git .
# Or: rsync -avz ~/vInfiSSO/ /opt/vinfisso/
```

---

## 📦 Deploy Application

### Apply pending database migrations before rollout

Production schema migrations are manual; the GitHub Actions deploy workflow
does not apply SQL files. Before deploying code that depends on a pending
migration, verify a recent database backup and apply the SQL from a checkout
that contains the migration file. For the coupon-redemption table, run this as
the PostgreSQL administrator before the application rollout:

```bash
cd /opt/vinfisso
sudo -u postgres psql -v ON_ERROR_STOP=1 -d vinfi_sso \
  -f migrations/20261022_coupon_redemptions.sql
```

This migration is safe to rerun: it preserves existing redemptions and reapplies
the table and sequence privileges required by the `vinfi_sso` runtime role.

### 1. Install Dependencies
```bash
cd /opt/vinfisso
npm install
```

### 2. Build Application
```bash
npm run build
```

### 3. Create Production .env File
```bash
sudo nano /opt/vinfisso/.env
```

**Paste this (update with your values):**
```env
# ─── Database ──────────────────────────────
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=vinfi_sso
DATABASE_PASSWORD=CHANGE_ME_SECURE_PASSWORD
DATABASE_NAME=vinfi_sso

# ─── App ────────────────────────────────
NODE_ENV=production
PORT=3000

# ─── JWT ────────────────────────────────
JWT_SECRET=generate-random-string-min-32-chars-use-openssl-rand-hex-16
JWT_EXPIRES_IN=7d
SESSION_SECRET=another-random-string-min-32-chars

# ─── Reading encryption (required before startup in every environment) ─────
# Generate a unique 32-byte key with: openssl rand -base64 32
# Replace this placeholder with the generated value in the server-only .env.
# Multiple keys use comma-separated keyId:base64 pairs for rotation.
DATA_ENCRYPTION_KEYS=k1:<base64-encoded-32-byte-key>
DATA_ENCRYPTION_ACTIVE_KEY_ID=k1

# ─── OAuth ──────────────────────────────
GOOGLE_CLIENT_ID=your-google-id
GOOGLE_CLIENT_SECRET=your-google-secret
GOOGLE_CALLBACK_URL=https://sso.vunph.click/sso/oauth/google/callback

FACEBOOK_APP_ID=your-facebook-id
FACEBOOK_APP_SECRET=your-facebook-secret
FACEBOOK_CALLBACK_URL=https://sso.vunph.click/sso/oauth/facebook/callback

# ─── Email (Local Postfix) ──────────────
MAIL_HOST=localhost
MAIL_PORT=25
MAIL_USER=
MAIL_PASSWORD=
MAIL_FROM=noreply@vunph.click

# ─── URLs ──────────────────────────────
SSO_BASE_URL=https://sso.vunph.click
ICHINGNOW_URL=https://vunph.click/kinhdich
TAROTNOW_URL=https://vunph.click/tarot
TUVINOW_URL=https://vunph.click/tuvi
TALKWITHME_URL=https://vunph.click/talkwithme

# ─── TalkWithMe Notifications ──────────
CONTACT_NOTIFY_EMAIL=admin@vunph.id.vn

# ─── CORS ──────────────────────────────
ALLOWED_ORIGINS=https://vunph.id.vn,https://www.vunph.id.vn,https://vunph.click,https://www.vunph.click
ALLOWED_REDIRECT_ORIGINS=https://vunph.id.vn,https://www.vunph.id.vn
TRUST_PROXY=loopback
```

### 4. Generate Secure Random Values
```bash
# Generate JWT_SECRET and SESSION_SECRET
openssl rand -hex 32
openssl rand -hex 32

# Generate one 32-byte reading encryption key on a trusted machine.
# Paste it directly into the server-only .env; do not commit or share it.
openssl rand -base64 32
```

### 5. Configure and Rotate the Reading Encryption Key

The service refuses to start in every environment if `DATA_ENCRYPTION_KEYS` or
`DATA_ENCRYPTION_ACTIVE_KEY_ID` is missing, malformed, or points to an unknown key.
Keep the production `.env` outside the repository, restrict it to the service
account (mode `0600`), and store a separate protected copy of each key in the
organization's secret manager and offline recovery location. Do not put generated
key values in this guide, source control, chat, or deployment logs.

Configuration steps:

1. On a trusted machine, run the key-generation command above and place the value
   directly in the organization's password manager or secret manager.
2. Edit the existing server-only file and add the two variables shown below:
   `sudoedit /opt/vinfisso/.env`.
3. Ensure the file is owned by the account that runs PM2 and is owner-readable
   only. Replace the placeholders below with that account and group:

   ```bash
   sudo chown <pm2-runtime-user>:<pm2-runtime-group> /opt/vinfisso/.env
   sudo chmod 600 /opt/vinfisso/.env
   pm2 restart vinfisso
   ```

4. Keep a separately protected key copy for recovery. Production startup validates
   the keyring and will refuse to start until the real values are configured.

Use this format in the server-only `.env`:

```env
DATA_ENCRYPTION_KEYS=k1:<base64-encoded-32-byte-key>
DATA_ENCRYPTION_ACTIVE_KEY_ID=k1
```

The active ID selects the key for new records. To rotate, first add the new key
without removing old IDs, then make it active, restart the service, and re-encrypt
existing records. Remove an old ID only after re-encryption is verified and no
records refer to it. Keep all retained key values backed up securely; losing a
key makes readings encrypted with that ID unrecoverable.

Before applying a migration, verify a recent database backup and secure backups
of the encryption keyring. The migration prints counts only and processes at most
200 records per batch. The production deploy installs only production
dependencies, so run the compiled script after building; it defaults to dry-run
and does not alter records unless `--apply` is supplied:

```bash
cd /opt/vinfisso
node dist/scripts/encrypt-readings.js --dry-run
node dist/scripts/encrypt-readings.js --apply
```

For a key rotation, re-encrypt v2 records under the configured active key:

```bash
node dist/scripts/encrypt-readings.js --apply --reencrypt
```

Do not run the apply commands until the database backup and key recovery copies
have been verified. These commands are documented only; this change does not run
the migration.

---

## 🔄 Setup Process Manager (PM2)

### Install PM2
```bash
sudo npm install -g pm2
```

### Create PM2 Ecosystem File
```bash
cat > /opt/vinfisso/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'vinfisso',
      script: './dist/src/main.js',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
    },
  ],
};
EOF
```

### Create logs directory
```bash
mkdir -p /opt/vinfisso/logs
```

### Start with PM2
```bash
cd /opt/vinfisso
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

---

## 🌐 Setup Nginx Reverse Proxy

### Install Nginx
```bash
sudo apt install nginx -y
```

### Configure Nginx
```bash
sudo nano /etc/nginx/sites-available/vinfisso
```

**Paste this:**
```nginx
upstream vinfisso {
  server 127.0.0.1:3000;
}

server {
  listen 80;
  server_name sso.vunph.click;
  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl http2;
  server_name sso.vunph.click;

  ssl_certificate /etc/letsencrypt/live/sso.vunph.click/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/sso.vunph.click/privkey.pem;

  # SSL security headers
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;
  ssl_prefer_server_ciphers on;

  client_max_body_size 10M;

  location / {
    proxy_pass http://vinfisso;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
  }
}
```

### Enable Site
```bash
sudo ln -s /etc/nginx/sites-available/vinfisso /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## ✅ Verify Deployment

### 1. Check Services Running
```bash
pm2 list
pm2 logs vinfisso
```

### 2. Test SSO API
```bash
curl -X GET https://sso.vunph.click/sso/me
```

### 3. Test Mail Server
```bash
sudo tail -f /var/log/mail.log
```

### 4. Test User Registration (Email will be sent)
```bash
curl -X POST https://sso.vunph.click/sso/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123456"}'
```

---

## 📊 Monitoring & Logs

### View Application Logs
```bash
pm2 logs vinfisso
pm2 logs vinfisso --lines 100
pm2 monit
```

### View Mail Logs
```bash
sudo tail -f /var/log/mail.log
```

### Check System Resources
```bash
free -h
df -h
top
```

### PostgreSQL Logs
```bash
sudo tail -f /var/log/postgresql/postgresql-*.log
```

---

## 🔄 Auto-Renew SSL Certificate

```bash
# Setup cron job for certificate renewal
sudo certbot renew --dry-run

# Add to crontab (runs monthly)
sudo crontab -e
# Add: 0 0 1 * * /usr/bin/certbot renew --quiet
```

---

## 🆘 Troubleshooting

### App won't start
```bash
pm2 logs vinfisso  # Check logs
npm run build      # Rebuild
```

### Database connection error
```bash
psql -U vinfi_sso -h localhost -d vinfi_sso
# Test connection
```

### Nginx error
```bash
sudo nginx -t
sudo systemctl status nginx
```

### Mail not sending
```bash
# Test Postfix
echo "Test email" | mail -s "Test" your-email@gmail.com
sudo postfix flush
sudo tail -f /var/log/mail.log
```

### Port 3000 already in use
```bash
sudo lsof -i :3000
sudo kill -9 <PID>
```

---

## 📝 Backup Strategy

### Database Backup
```bash
sudo -u postgres pg_dump vinfi_sso > /backup/vinfi_sso_$(date +%Y%m%d).sql
```

### Application Backup
```bash
tar -czf /backup/vinfisso_$(date +%Y%m%d).tar.gz /opt/vinfisso
```

---

## 🔐 Security Checklist

- [ ] SSH key-based authentication enabled
- [ ] Firewall configured
- [ ] SSL certificate installed
- [ ] Database user has strong password
- [ ] JWT_SECRET and SESSION_SECRET are strong
- [ ] PostgreSQL only listens on localhost
- [ ] Regular backups scheduled
- [ ] Log rotation configured
- [ ] Fail2ban installed for brute-force protection

---

## 📞 Quick Commands

```bash
# Start/Stop/Restart
pm2 stop vinfisso
pm2 start vinfisso
pm2 restart vinfisso

# Redeploy with new code
cd /opt/vinfisso
git pull
npm install
npm run build
pm2 restart vinfisso

# Logs
pm2 logs vinfisso
tail -f /var/log/mail.log
```

---

**Ready to deploy? SSH into your VPS and follow the steps above!** 🚀

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
SESSION_SECRET=GENERATE_WITH: openssl rand -hex 32

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
ALLOWED_ORIGINS=https://vunph.click,https://www.vunph.click
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
- [ ] Regular backups scheduled
- [ ] Log rotation configured
- [ ] All environment variables secured
- [ ] OAuth credentials are correct

---

## 💾 Backup Commands

```bash
# Database backup
sudo -u postgres pg_dump vinfi_sso > ~/backup_$(date +%Y%m%d).sql

# Application backup
tar -czf ~/app_backup_$(date +%Y%m%d).tar.gz /opt/vinfisso

# Restore database
sudo -u postgres psql vinfi_sso < backup.sql
```

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

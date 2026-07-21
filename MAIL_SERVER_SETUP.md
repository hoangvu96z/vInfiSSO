# Setup Mail Server on Linux VPS

## 📋 Prerequisites
- Linux VPS (Ubuntu 20.04+ recommended)
- SSH access
- Domain for mail server (e.g., mail.vunph.click or direct IP)

---

## 🚀 Option 1: Setup Postfix + Dovecot (Full Mail Server)

### Step 1: Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### Step 2: Install Postfix
```bash
sudo apt install postfix -y
```
During installation, select:
- **Mail Server Type**: Internet Site
- **Mail name**: vunph.click

### Step 3: Configure Postfix
```bash
sudo nano /etc/postfix/main.cf
```

Find and update these lines:
```ini
# Set hostname
myhostname = mail.vunph.click
mydomain = vunph.click
myorigin = $mydomain

# Allow relay from localhost
mynetworks = 127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128

# Set mailbox size
mailbox_size_limit = 0
message_size_limit = 102400000

# Enable SMTP submission port
smtpd_sasl_auth_enable = yes
smtpd_sasl_security_options = noanonymous
smtpd_sasl_type = dovecot
smtpd_sasl_path = private/auth

# TLS settings (optional, for security)
smtpd_tls_cert_file = /etc/ssl/certs/ssl-cert-snakeoil.pem
smtpd_tls_key_file = /etc/ssl/private/ssl-cert-snakeoil.key
smtpd_use_tls = yes
```

Restart Postfix:
```bash
sudo systemctl restart postfix
```

### Step 4: Install & Configure Dovecot (Optional, for receiving emails)
```bash
sudo apt install dovecot-core dovecot-imapd -y
```

Configure:
```bash
sudo nano /etc/dovecot/dovecot.conf
```

Add/uncomment:
```ini
protocols = imap
listen = *, ::

# Use system users
userdb {
  driver = passwd
}

# SASL for Postfix
service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0666
  }
}
```

Restart Dovecot:
```bash
sudo systemctl restart dovecot
```

---

## 🚀 Option 2: Quick Setup - Postfix Only (SMTP Relay)

### For simplicity, just install Postfix:
```bash
sudo apt install postfix -y
```

Configure for local delivery:
```bash
sudo postfix set-permissions
sudo systemctl restart postfix
```

Test SMTP:
```bash
echo "Test email" | mail -s "Test" your-email@gmail.com
```

---

## 🔐 SSL/TLS Certificate (Optional but Recommended)

### Using Let's Encrypt:
```bash
sudo apt install certbot -y
sudo certbot certonly --standalone -d mail.vunph.click
```

Update Postfix config:
```bash
sudo nano /etc/postfix/main.cf
```

Add:
```ini
smtpd_tls_cert_file = /etc/letsencrypt/live/mail.vunph.click/fullchain.pem
smtpd_tls_key_file = /etc/letsencrypt/live/mail.vunph.click/privkey.pem
smtpd_use_tls = yes
```

---

## 📝 Firewall Setup

### Allow SMTP ports:
```bash
sudo ufw allow 25/tcp
sudo ufw allow 587/tcp  # Submission port
sudo ufw allow 465/tcp  # SMTPS port
sudo ufw allow 143/tcp  # IMAP (Dovecot)
sudo ufw allow 993/tcp  # IMAPS
```

---

## ✅ Testing Mail Server

### Check if Postfix is running:
```bash
sudo systemctl status postfix
```

### Test SMTP connection:
```bash
telnet localhost 25
# or
nc -zv localhost 25
```

### Check Postfix logs:
```bash
tail -f /var/log/mail.log
```

---

## 🔗 Connect Nodemailer to Local Mail Server

Once Postfix is running, update your `.env`:

```env
MAIL_HOST=localhost
MAIL_PORT=25
MAIL_USER=          # Leave empty for local Postfix
MAIL_PASSWORD=      # Leave empty for local Postfix
MAIL_FROM=noreply@vunph.click
```

Or if using port 587 with authentication:
```env
MAIL_HOST=mail.vunph.click
MAIL_PORT=587
MAIL_USER=your-user
MAIL_PASSWORD=your-password
MAIL_FROM=noreply@vunph.click
```

---

## 🎯 For Production (sso.vunph.click)

**Recommended approach:**
1. Use a separate mail server (can be same VPS or different)
2. Or use a managed service (SendGrid, Mailgun) for reliability

**Update .env on deployment:**
```env
MAIL_HOST=mail.vunph.click
MAIL_PORT=587
MAIL_USER=sso@vunph.click
MAIL_PASSWORD=your-secure-password
MAIL_FROM=noreply@vunph.click
SSO_BASE_URL=https://sso.vunph.click
```

---

## 📊 Monitor Mail Server

```bash
# Check queue
sudo postqueue -p

# View statistics
sudo postfix flush

# Clear stuck emails
sudo postsuper -d ALL deferred
```

---

## 🆘 Troubleshooting

### Emails stuck in queue:
```bash
sudo postfix flush
```

### Permission denied:
```bash
sudo chown postfix:postfix /var/spool/postfix
```

### Check if port is listening:
```bash
sudo netstat -tlnp | grep postfix
```

### Test sending email via telnet:
```bash
telnet localhost 25
# Then type:
ehlo localhost
mail from: noreply@vunph.click
rcpt to: recipient@example.com
data
Subject: Test Email
This is a test
.
quit
```

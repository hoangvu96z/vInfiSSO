#!/bin/bash

# vInfiSSO VPS Setup - Quick Script
# Run this script on your VPS to setup everything at once

set -e

echo "🚀 Starting vInfiSSO VPS Setup..."
echo "=================================="

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js
echo "📦 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install nodejs -y

# Install PostgreSQL
echo "📦 Installing PostgreSQL..."
sudo apt install postgresql postgresql-contrib -y

# Install Postfix
echo "📦 Installing Postfix..."
sudo DEBIAN_FRONTEND=noninteractive apt install postfix -y

# Install Certbot
echo "📦 Installing Certbot..."
sudo apt install certbot python3-certbot-nginx -y

# Install Nginx
echo "📦 Installing Nginx..."
sudo apt install nginx -y

# Install PM2 globally
echo "📦 Installing PM2..."
sudo npm install -g pm2

echo ""
echo "✅ Dependencies installed!"
echo ""
echo "📋 Next Steps:"
echo "1. Create PostgreSQL database:"
echo "   sudo -u postgres psql"
echo "   postgres=# CREATE USER vinfi_sso WITH PASSWORD 'STRONG_PASSWORD';"
echo "   postgres=# CREATE DATABASE vinfi_sso OWNER vinfi_sso;"
echo "   postgres=# GRANT ALL PRIVILEGES ON DATABASE vinfi_sso TO vinfi_sso;"
echo "   postgres=# \\q"
echo ""
echo "2. Setup SSL certificate:"
echo "   sudo certbot certonly --standalone -d sso.vunph.click"
echo ""
echo "3. Configure Postfix:"
echo "   sudo nano /etc/postfix/main.cf"
echo "   (Update myhostname, mydomain, myorigin)"
echo "   sudo systemctl restart postfix"
echo ""
echo "4. Upload/Clone application"
echo "5. Run DEPLOYMENT_GUIDE.md steps"
echo ""
echo "=================================="
echo "✨ Setup complete! Follow the Next Steps"

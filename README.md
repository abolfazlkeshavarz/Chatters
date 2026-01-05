
# 🚀 Chatters Deployment & Database Migration Guide

This document provides a comprehensive, phase-based approach to deploying the Chatters application on a VPS and managing its database schema using production-grade practices.

## 🧭 PHASE 1 — VPS INITIAL SETUP

1. Connect to VPS

   ```bash
   ssh root@YOUR_VPS_IP
   ```

2. Update system

   ```bash
   apt update && apt upgrade -y
   ```

3. Install essential tools

   ```bash
   apt install -y git curl unzip ufw
   ```

## 🔐 PHASE 2 — SECURITY BASELINE

1. Configure Firewall (UFW)

   ```bash
   ufw allow OpenSSH
   ufw allow 80
   ufw allow 443
   ufw enable
   ```

2. Create non-root user (Recommended)

   ```bash
   adduser chatters
   usermod -aG sudo chatters
   # Re-login as 'chatters'
   ```

## 🧱 PHASE 3 — INSTALL REQUIRED SOFTWARE

1. Install Go

   ```bash
   wget https://go.dev/dl/go1.22.0.linux-amd64.tar.gz
   rm -rf /usr/local/go && tar -C /usr/local -xzf go1.22.0.linux-amd64.tar.gz
   echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
   source ~/.bashrc
   ```

2. Install Infrastructure Components

   - **PostgreSQL**:

     ```bash
     apt install -y postgresql postgresql-contrib
     ```

   - **Nginx**:

     ```bash
     apt install -y nginx
     ```

   - **Node.js**:

     ```bash
     curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
     apt install -y nodejs
     ```

## 🗄️ PHASE 4 — DATABASE ARCHITECTURE

1. Initial Database Creation

   ```sql
   sudo -u postgres psql
   CREATE DATABASE chatters;
   CREATE USER chatters_user WITH PASSWORD 'STRONG_PASSWORD';
   GRANT ALL PRIVILEGES ON DATABASE chatters TO chatters_user;
   \q
   ```

2. Table Schema Management

   We use a versioned migration strategy to ensure production stability.

   ### Option A: Manual SQL Schema (Best for Initial Setup)

   Create `/opt/chatters/backend/schema.sql`:

   ```sql
   CREATE EXTENSION IF NOT EXISTS "pgcrypto";

   CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     email TEXT UNIQUE NOT NULL,
     password_hash TEXT NOT NULL,
     created_at TIMESTAMP DEFAULT now()
   );

   CREATE TABLE IF NOT EXISTS chats (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     is_group BOOLEAN DEFAULT false
   );

   CREATE TABLE IF NOT EXISTS messages (
     id SERIAL PRIMARY KEY,
     chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
     sender_id TEXT REFERENCES users(id),
     content TEXT,
     created_at TIMESTAMP DEFAULT now()
   );
   ```

   Apply the schema:

   ```bash
   psql -U chatters_user -d chatters -f schema.sql
   ```

   ### Option B: Versioned Migrations (Best for Evolving Apps)

   Install golang-migrate:

   ```bash
   curl -L https://github.com/golang-migrate/migrate/releases/latest/download/migrate.linux-amd64.tar.gz | tar xvz
   mv migrate /usr/local/bin/
   ```

   Run migrations:

   ```bash
   migrate -path ./migrations -database "postgres://chatters_user:PASS@localhost:5432/chatters?sslmode=disable" up
   ```

## 📂 PHASE 5 — BACKEND DEPLOYMENT

1. Clone & Configure

   ```bash
   mkdir -p /opt/chatters && cd /opt/chatters
   git clone YOUR_REPO backend
   cd backend
   nano .env # Add DB credentials and JWT secrets
   ```

2. Build & Test

   ```bash
   go mod tidy
   go build -o chatters-server ./cmd/server
   ./chatters-server # Test then Ctrl+C
   ```

## 🔁 PHASE 6 — SYSTEMD SERVICE

Create `/etc/systemd/system/chatters.service`:

```ini
[Unit]
Description=Chatters Backend
After=network.target

[Service]
WorkingDirectory=/opt/chatters/backend
ExecStart=/opt/chatters/backend/chatters-server
EnvironmentFile=/opt/chatters/backend/.env
Restart=always
User=chatters

[Install]
WantedBy=multi-user.target
```

Activate the service:

```bash
systemctl daemon-reload
systemctl enable --now chatters
```

## 🌐 PHASE 7 — NGINX & SSL (HTTPS)

1. Configure API Proxy (`/etc/nginx/sites-available/chatters-api`)

   ```nginx
   server {
     listen 80;
     server_name api.chatters.app;

     location / {
       proxy_pass http://localhost:8080;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
     }
   }
   ```

2. Enable HTTPS with Certbot

   ```bash
   apt install -y certbot python3-certbot-nginx
   certbot --nginx -d chatters.app -d api.chatters.app
   ```

## ✅ FINAL PRODUCTION CHECKLIST

- [x] Backend running as systemd service
- [x] SSL active (A+ rating)
- [x] Database migrations versioned
- [x] Firewall active
- [x] Non-root user execution

## 🧠 Mental Model

```mermaid
graph TD
    User((User Browser)) -->|HTTPS| Nginx{Nginx Proxy}
    Nginx -->|Port 80/443| Frontend[Static React/Vue]
    Nginx -->|Port 8080| Backend[Go Server]
    Backend --> DB[(PostgreSQL)]
    Backend --> FS[Private Uploads]
```
```

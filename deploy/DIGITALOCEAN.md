# FlowPilot AI: DigitalOcean Production Deployment Guide

This guide walks you through deploying **FlowPilot AI** to a DigitalOcean Droplet using the included production Docker Compose stack and Caddy reverse proxy.

---

## 1. Droplet Hardware Recommendation

In your DigitalOcean dashboard, create a new Droplet:
* **Image**: **Ubuntu 24.04 (LTS) x64**
* **Plan**: **Basic**
* **CPU Options**: **Premium AMD** or **Regular**
* **Recommended Specs**:
  - **Starter**: 2 vCPU / 4 GB RAM / 80 GB SSD ($24/month)
  - **Minimum**: 1 vCPU / 2 GB RAM / 50 GB SSD ($12/month) *(Note: our setup script adds 2GB swap memory so Next.js Turbopack compiles smoothly)*
* **Region**: Choose the datacenter closest to your target users (e.g., NYC, Frankfurt, London, Singapore).
* **Authentication**: SSH Key (Recommended).

---

## 2. DNS Configuration

Before launching, configure your domain's DNS:
1. Go to your DNS provider (Cloudflare, Namecheap, GoDaddy, DigitalOcean DNS).
2. Add an **`A` record**:
   - **Host / Name**: `flowpilot` (or `@` for root domain)
   - **Value**: Your DigitalOcean Droplet's **Public IPv4 Address**
   - **TTL**: Auto or 300 seconds
3. *(If using Cloudflare, temporarily set proxy status to "DNS Only" / grey cloud during initial SSL issuance).*

---

## 3. Server Setup (Automated in 60 Seconds)

SSH into your fresh Droplet:
```bash
ssh root@<YOUR_DROPLET_IP>
```

Run our automated setup script:
```bash
curl -fsSL https://raw.githubusercontent.com/karakaraye/FLOW/main/deploy/digitalocean-setup.sh | bash
```

This automatically:
- Installs Docker & Docker Compose v2.
- Creates 2GB swap memory.
- Configures UFW firewall (blocking all ports except SSH 22, HTTP 80, and HTTPS 443).

---

## 4. Deploying FlowPilot AI

### 1. Clone your repository:
```bash
git clone https://github.com/karakaraye/FLOW.git /opt/flowpilot
cd /opt/flowpilot
```

### 2. Generate production secrets:
Run the secret generator with your custom domain:
```bash
node scripts/operations/generate-production-secrets.mjs https://flowpilot.yourcompany.com
```

Copy the generated file to `.env`:
```bash
cp .env.production.example .env
nano .env
```

### 3. Set your live keys in `.env`:
- **`PUBLIC_HOST`**: Set to your domain (e.g. `flowpilot.yourcompany.com` without `https://`).
- **`POSTGRES_PASSWORD`**: Set a strong random password for PostgreSQL.
- **`DATABASE_URL`**: Update the password to match:
  `postgresql://flowpilot:YOUR_POSTGRES_PASSWORD@db:5432/flowpilot?schema=public`
- **`RESEND_API_KEY`**: Paste your Resend API key (`re_...`).
- Optional live keys: `FLOWPILOT_OPENAI_API_KEY`, `GOOGLE_OAUTH_*`, `META_*`.

### 4. Launch the stack:
```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

---

## 5. What Happens Automatically

When you run `docker compose up -d`:
1. **PostgreSQL 17** starts up with persistent volume storage (`postgres_prod_data`).
2. **Migrator** container runs all 27 database migrations (`prisma migrate deploy`) and seeds the initial starter templates.
3. **Web** (`flowpilot-web`) and **Worker** (`flowpilot-worker`) start up once database migrations succeed.
4. **Caddy** automatically communicates with Let's Encrypt, obtains trusted HTTPS certificates for your domain, and starts serving traffic!

---

## 6. Verifying & Managing Your Deployment

### Check service health:
```bash
docker compose -f deploy/docker-compose.prod.yml ps
```

### View real-time logs:
```bash
# Web application logs
docker compose -f deploy/docker-compose.prod.yml logs -f web

# Background worker queue logs
docker compose -f deploy/docker-compose.prod.yml logs -f worker

# Caddy SSL & reverse proxy logs
docker compose -f deploy/docker-compose.prod.yml logs -f edge
```

### Database Backup & Maintenance:
Run an encrypted database backup:
```bash
docker compose -f deploy/docker-compose.prod.yml exec web npm run ops:backup
```

### Updating to New Releases:
When you push new code to GitHub:
```bash
cd /opt/flowpilot
git pull
docker compose -f deploy/docker-compose.prod.yml up -d --build
```
The migrator container will automatically apply any new database migrations before the web and worker containers reload with zero downtime.

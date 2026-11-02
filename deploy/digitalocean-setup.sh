#!/usr/bin/env bash
# ==============================================================================
# FlowPilot AI - DigitalOcean Droplet Automated Host Setup Script
# Run on fresh Ubuntu 24.04 LTS:
# curl -fsSL https://raw.githubusercontent.com/karakaraye/FLOW/main/deploy/digitalocean-setup.sh | bash
# ==============================================================================

set -euo pipefail

echo "=================================================================="
echo "🚀 FlowPilot AI: Initializing DigitalOcean Droplet"
echo "=================================================================="

# 1. System Updates
echo "📦 Updating system packages..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
apt-get install -y -qq curl git ufw fail2ban jq

# 2. Add 2GB Swap (Prevents Out-Of-Memory on Turbopack builds)
if [ ! -f /swapfile ]; then
    echo "💾 Creating 2GB swap file..."
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 3. Install Docker & Docker Compose v2
if ! command -v docker &> /dev/null; then
    echo "🐳 Installing Docker Engine..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

# 4. Configure UFW Firewall (Only Ports 22, 80, 443)
echo "🛡️ Configuring UFW firewall rules..."
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "=================================================================="
echo "✅ DigitalOcean host is fully prepared for FlowPilot AI!"
echo "=================================================================="
echo ""
echo "Next Steps:"
echo "1. Clone your repository:"
echo "   git clone https://github.com/karakaraye/FLOW.git /opt/flowpilot && cd /opt/flowpilot"
echo ""
echo "2. Create production .env file:"
echo "   cp .env.production.example .env"
echo "   nano .env"
echo ""
echo "3. Launch the stack:"
echo "   docker compose -f deploy/docker-compose.prod.yml up -d --build"
echo ""
echo "4. Point your domain's DNS 'A' record to this Droplet's IP address."
echo "   Caddy will automatically issue your SSL certificate."
echo "=================================================================="

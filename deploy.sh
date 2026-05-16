#!/usr/bin/env bash
set -euo pipefail

APP_NAME="fundsflee"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-3000}"
DOMAIN="fundsflee.voidall.com"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step()  { echo -e "\n${BLUE}──${NC} $*"; }

echo ""
echo "  FundsFlee — VPS deploy (Cloudflare Tunnel)"
echo "  ─────────────────────────────────────────"

# ── 1. Node.js ────────────────────────────────────────────────────────────────
step "Node.js"
if ! command -v node &>/dev/null; then
  # Try loading nvm first (may already be installed)
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
fi
if ! command -v node &>/dev/null; then
  warn "Node.js not found — installing via nvm..."
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  # shellcheck source=/dev/null
  source "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm use --lts
fi
info "Node.js $(node -v)"

# ── 2. PM2 ────────────────────────────────────────────────────────────────────
step "PM2"
if ! command -v pm2 &>/dev/null; then
  warn "PM2 not found — installing..."
  npm install -g pm2
fi
info "PM2 $(pm2 --version)"

# ── 3. .env.local ─────────────────────────────────────────────────────────────
step ".env.local"
if [ ! -f "$APP_DIR/.env.local" ]; then
  error ".env.local not found.\n\n  cp $APP_DIR/.env.local.example $APP_DIR/.env.local\n  nano $APP_DIR/.env.local\n\n  Then re-run this script."
fi
info ".env.local found"

NEXTAUTH_URL=$(grep -E '^NEXTAUTH_URL=' "$APP_DIR/.env.local" | cut -d= -f2- | tr -d '"' || true)
if [[ "$NEXTAUTH_URL" == *"localhost"* ]]; then
  warn "NEXTAUTH_URL is still localhost — set it to https://$DOMAIN"
fi

# ── 4. Install dependencies ───────────────────────────────────────────────────
step "Dependencies"
cd "$APP_DIR"
npm ci --prefer-offline 2>&1 | tail -3
info "Dependencies installed"

# ── 5. Build ──────────────────────────────────────────────────────────────────
step "Build"
npm run build 2>&1 | tail -5
info "Build complete"

# ── 6. Start / restart with PM2 ───────────────────────────────────────────────
step "PM2 process"
if pm2 describe "$APP_NAME" &>/dev/null; then
  info "Restarting existing PM2 process '$APP_NAME'..."
  pm2 restart "$APP_NAME" --update-env
else
  info "Starting '$APP_NAME' on port $PORT..."
  pm2 start npm --name "$APP_NAME" -- start -- -p "$PORT"
fi
pm2 save

STARTUP_CMD=$(pm2 startup 2>&1 | grep "sudo" || true)
if [ -n "$STARTUP_CMD" ]; then
  warn "Run this once to enable auto-start on reboot:"
  echo ""
  echo "    $STARTUP_CMD"
  echo ""
fi

# ── 7. Cloudflare Tunnel ──────────────────────────────────────────────────────
step "Cloudflare Tunnel"

# Locate the cloudflared config file
CF_CONFIG=""
for candidate in \
    /etc/cloudflared/config.yml \
    /root/.cloudflared/config.yml \
    "$HOME/.cloudflared/config.yml"; do
  if [ -f "$candidate" ]; then
    CF_CONFIG="$candidate"
    break
  fi
done

if [ -z "$CF_CONFIG" ]; then
  warn "cloudflared config not found. Add the route manually:"
  echo ""
  echo "  Edit your tunnel config (e.g. /etc/cloudflared/config.yml):"
  echo "  Add this line in the ingress section BEFORE the catch-all:"
  echo ""
  echo "    - hostname: $DOMAIN"
  echo "      service: http://localhost:$PORT"
  echo ""
  echo "  Then: sudo systemctl restart cloudflared"
else
  info "Found cloudflared config: $CF_CONFIG"

  # Check if this hostname is already in the config
  if grep -q "$DOMAIN" "$CF_CONFIG"; then
    info "$DOMAIN already in tunnel config — no change needed"
  else
    # Insert the new ingress rule before the catch-all (last line with just 'service:')
    # Back up first
    sudo cp "$CF_CONFIG" "${CF_CONFIG}.bak"

    # Insert before the catch-all rule (the line that has 'service:' but no 'hostname:')
    sudo python3 - "$CF_CONFIG" "$DOMAIN" "$PORT" <<'PYEOF'
import sys, re

config_path, domain, port = sys.argv[1], sys.argv[2], sys.argv[3]
new_rule = f"  - hostname: {domain}\n    service: http://localhost:{port}\n"

with open(config_path) as f:
    content = f.read()

# Insert before the final catch-all service line
# The catch-all looks like:  - service: http_status:404  (no hostname:)
catchall = re.search(r'^(\s*- service:\s*http_status:\d+\s*)$', content, re.MULTILINE)
if catchall:
    content = content[:catchall.start()] + new_rule + content[catchall.start():]
else:
    # No catch-all found — just append to ingress block
    content = content.rstrip() + "\n" + new_rule

with open(config_path, 'w') as f:
    f.write(content)

print("Config updated.")
PYEOF

    info "Added $DOMAIN → localhost:$PORT to tunnel config"

    # Restart cloudflared
    if systemctl is-active --quiet cloudflared 2>/dev/null; then
      sudo systemctl restart cloudflared
      info "cloudflared restarted"
    elif systemctl is-active --quiet cloudflared@* 2>/dev/null; then
      sudo systemctl restart 'cloudflared@*'
      info "cloudflared restarted"
    else
      warn "Could not restart cloudflared automatically."
      echo "  Run: sudo systemctl restart cloudflared"
    fi
  fi

  # Add DNS route via cloudflared (idempotent — safe to run multiple times)
  if command -v cloudflared &>/dev/null; then
    TUNNEL_ID=$(grep -E '^tunnel:' "$CF_CONFIG" | awk '{print $2}' | tr -d '"' || true)
    if [ -n "$TUNNEL_ID" ]; then
      cloudflared tunnel route dns "$TUNNEL_ID" "$DOMAIN" 2>/dev/null && \
        info "DNS route added: $DOMAIN → tunnel $TUNNEL_ID" || \
        warn "DNS route may already exist or needs manual setup in Cloudflare dashboard"
    fi
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ─────────────────────────────────────────"
info "Done!"
echo ""
echo "  App running locally on port $PORT"
echo "  Tunnel:  https://$DOMAIN"
echo ""
echo "  Useful commands:"
echo "    pm2 logs $APP_NAME              — live app logs"
echo "    pm2 status                      — process status"
echo "    pm2 restart $APP_NAME           — restart app"
echo "    sudo systemctl status cloudflared — tunnel status"
echo "    cloudflared tunnel info          — tunnel details"
echo ""
echo "  To update: git pull && bash deploy.sh"
echo ""

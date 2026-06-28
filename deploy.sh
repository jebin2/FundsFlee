#!/usr/bin/env bash
set -euo pipefail

APP_NAME="fundsflee"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
PORT="${PORT:-3000}"                 # matches the existing Cloudflare Tunnel route
DOMAIN="fundsflee.voidall.com"
PYENV_ENV="${PYENV_ENV:-FundsFlee_env}"
PYTHON="$HOME/.pyenv/versions/$PYENV_ENV/bin/python"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step()  { echo -e "\n${BLUE}──${NC} $*"; }

echo ""
echo "  FundsFlee — VPS deploy (FastAPI + React SPA, single origin, Cloudflare Tunnel)"
echo "  ─────────────────────────────────────────────────────────────────────────────"

# ── 1. Node.js (>=20 required by Vite 8 — used only to BUILD the SPA) ─────────
step "Node.js"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
NODE_MAJOR=$(node -e "console.log(parseInt(process.version.slice(1)))" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 20 ] 2>/dev/null; then
  warn "Node.js $(node -v 2>/dev/null || echo 'not found') too old — Vite needs >=20. Upgrading via nvm..."
  if ! command -v nvm &>/dev/null; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    source "$NVM_DIR/nvm.sh"
  fi
  nvm install 20 && nvm use 20 && nvm alias default 20
fi
info "Node.js $(node -v)"

# ── 2. PM2 ────────────────────────────────────────────────────────────────────
step "PM2"
if ! command -v pm2 &>/dev/null; then
  warn "PM2 not found — installing..."
  npm install -g pm2 2>/dev/null || sudo npm install -g pm2
fi
info "PM2 $(pm2 --version)"

# ── 3. Python backend environment (pyenv-virtualenv) ─────────────────────────
step "Python env ($PYENV_ENV)"
if [ ! -x "$PYTHON" ]; then
  error "pyenv env '$PYENV_ENV' not found at $PYTHON.\n\n  Create it once, e.g.:\n    pyenv install 3.12.8   # if needed\n    pyenv virtualenv 3.12.8 $PYENV_ENV\n\n  Then re-run this script."
fi
info "Python $("$PYTHON" --version 2>&1 | awk '{print $2}')"

# ── 4. .env.local ─────────────────────────────────────────────────────────────
step "Environment"
if [ ! -f "$APP_DIR/.env.local" ]; then
  error ".env.local not found at $APP_DIR/.env.local"
fi
# The backend reads ../.env.local (BASE_URL falls back to NEXTAUTH_URL).
AUTH_URL=$(grep -E '^NEXTAUTH_URL=' "$APP_DIR/.env.local" | cut -d= -f2- | tr -d '"' || true)
[[ "$AUTH_URL" == *"localhost"* ]] && warn "NEXTAUTH_URL is localhost — set it to https://$DOMAIN (used as BASE_URL)."
# Register https://$DOMAIN/auth/google/callback as an authorized redirect URI in Google Console.
info ".env.local found"

# ── 5. Backend dependencies ───────────────────────────────────────────────────
step "Backend dependencies"
"$PYTHON" -m pip install --quiet --upgrade pip
"$PYTHON" -m pip install --quiet -r "$BACKEND_DIR/requirements.txt"
mkdir -p "$BACKEND_DIR/data"
info "Backend deps installed"

# ── 6. Build the SPA ──────────────────────────────────────────────────────────
step "Frontend build"
cd "$FRONTEND_DIR"
# Surface the VAPID public key to the build so web-push works (optional).
VAPID_PUB=$(grep -E '^VAPID_PUBLIC_KEY=' "$APP_DIR/.env.local" | cut -d= -f2- | tr -d '"' || true)
if [ -n "$VAPID_PUB" ]; then
  echo "VITE_VAPID_PUBLIC_KEY=$VAPID_PUB" > "$FRONTEND_DIR/.env.production"
  info "VITE_VAPID_PUBLIC_KEY wired for push"
else
  rm -f "$FRONTEND_DIR/.env.production"
  warn "VAPID_PUBLIC_KEY not set — push notifications stay disabled."
fi
npm ci --prefer-offline 2>&1 | tail -3
rm -rf "$FRONTEND_DIR/dist"
npm run build
info "SPA built → frontend/dist"

# ── 7. Start / restart the backend with PM2 (single worker) ──────────────────
step "PM2 process"
# IMPORTANT: ONE worker — in-process scheduler + in-memory shortcut-prepare store.
pm2 delete "$APP_NAME" 2>/dev/null || true
info "Starting '$APP_NAME' (uvicorn) on 127.0.0.1:$PORT..."
pm2 start "$PYTHON" \
  --name "$APP_NAME" \
  --cwd "$BACKEND_DIR" \
  --interpreter none \
  --time \
  -- -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" --workers 1 --no-access-log
pm2 save

STARTUP_CMD=$(pm2 startup 2>&1 | grep "sudo" || true)
if [ -n "$STARTUP_CMD" ]; then
  eval "$STARTUP_CMD" && info "PM2 registered for auto-start on reboot" \
    || warn "Could not register PM2 startup — run manually: $STARTUP_CMD"
fi

# ── 8. Cloudflare Tunnel (route unchanged — still → localhost:$PORT) ──────────
step "Cloudflare Tunnel"
CF_CONFIG=""
for candidate in /etc/cloudflared/config.yml /root/.cloudflared/config.yml "$HOME/.cloudflared/config.yml"; do
  [ -f "$candidate" ] && { CF_CONFIG="$candidate"; break; }
done

if [ -z "$CF_CONFIG" ]; then
  warn "cloudflared config not found. Ensure this ingress rule exists:"
  echo "    - hostname: $DOMAIN"
  echo "      service: http://localhost:$PORT"
elif grep -q "$DOMAIN" "$CF_CONFIG"; then
  info "$DOMAIN already routed in tunnel config — no change needed"
else
  sudo cp "$CF_CONFIG" "${CF_CONFIG}.bak"
  sudo python3 - "$CF_CONFIG" "$DOMAIN" "$PORT" <<'PYEOF'
import sys, re
config_path, domain, port = sys.argv[1], sys.argv[2], sys.argv[3]
new_rule = f"  - hostname: {domain}\n    service: http://localhost:{port}\n"
content = open(config_path).read()
m = re.search(r'^(\s*- service:\s*http_status:\d+\s*)$', content, re.MULTILINE)
content = (content[:m.start()] + new_rule + content[m.start():]) if m else (content.rstrip() + "\n" + new_rule)
open(config_path, 'w').write(content)
print("Config updated.")
PYEOF
  info "Added $DOMAIN → localhost:$PORT to tunnel config"
  systemctl is-active --quiet cloudflared 2>/dev/null && sudo systemctl restart cloudflared && info "cloudflared restarted" \
    || warn "Restart cloudflared manually: sudo systemctl restart cloudflared"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ─────────────────────────────────────────"
info "Done!"
echo ""
echo "  Single origin: FastAPI serves the API + the built SPA on 127.0.0.1:$PORT"
echo "  Tunnel:  https://$DOMAIN"
echo ""
echo "  Useful commands:"
echo "    pm2 logs $APP_NAME        — live backend logs"
echo "    pm2 restart $APP_NAME     — restart"
echo "    pm2 status                — process status"
echo ""
echo "  To update: git pull && bash deploy.sh"
echo ""

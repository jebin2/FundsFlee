#!/usr/bin/env bash
set -euo pipefail

APP_NAME="fundsflee"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
PREFERRED_PORT=3000
# Empty unless the caller set PORT= — an explicit port is honoured as given.
PORT_REQUESTED="${PORT:-}"
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

# ── Port and route safety ─────────────────────────────────────────────────────
# Nothing outside this VPS refers to a port — every app is reached by its
# subdomain through the tunnel — so the port is an implementation detail and
# this script picks a free one rather than insisting on a number.
#
# Preferred ports, if free:
#   3000  FundsFlee          (fundsflee.voidall.com)
#   7860  youtube-downloader (yt.voidall.com)
#   7861  TTT hf_backend     (ttt.voidall.com)
#
# 7860 is the Hugging Face default, which is why two of these wanted it.
#
# One rule keeps "pick a free port" from being chaos: THE TUNNEL IS THE SOURCE
# OF TRUTH. A hostname already routed keeps the port its rule names, so
# redeploying can never drift onto a new port and strand the rule pointing at
# nothing. A new hostname takes its preferred port, or the next free one.

find_cf_config() {
  local candidate
  for candidate in /etc/cloudflared/config.yml /root/.cloudflared/config.yml "$HOME/.cloudflared/config.yml"; do
    [ -f "$candidate" ] && { printf '%s' "$candidate"; return; }
  done
}

# "hostname port" per ingress rule.
tunnel_rules() {
  [ -f "${1:-}" ] || return 0
  python3 - "$1" <<'PYEOF'
import re, sys
text = open(sys.argv[1]).read()
for host, svc in re.findall(r"-\s*hostname:\s*(\S+)\s*\n\s*service:\s*(\S+)", text):
    m = re.search(r":(\d+)\s*$", svc)
    print(host, m.group(1) if m else "")
PYEOF
}

# Who is listening on $1, if anyone. Empty when the port is free.
port_holder() {
  ss -ltnp 2>/dev/null | awk -v p=":$1\$" '$4 ~ p {print $NF; exit}'
}

# True when the port is ours already, or nobody's.
port_is_ours_or_free() {
  local port="$1" me="$2" holder mypid
  holder=$(port_holder "$port")
  [ -z "$holder" ] && return 0
  mypid=$(pm2 pid "$me" 2>/dev/null || true)
  [ -n "$mypid" ] && printf '%s' "$holder" | grep -q "pid=$mypid"
}

# Refuse to take a port that belongs to something else. pm2 delete + pm2 start
# would otherwise "succeed" and leave this app crash-looping on EADDRINUSE.
assert_port_available() {
  local port="$1" me="$2" holder other
  port_is_ours_or_free "$port" "$me" && return 0
  holder=$(port_holder "$port")
  other=$(pm2 jlist 2>/dev/null | python3 -c "
import json, sys
try: procs = json.load(sys.stdin)
except Exception: procs = []
print(' '.join(p['name'] for p in procs if p.get('name') != '$me'
                and p.get('pm2_env', {}).get('status') == 'online'))
" 2>/dev/null || true)
  error "Port $port is already in use by: $holder
  Starting '$me' here would crash-loop on EADDRINUSE, so this stops now.
  Other PM2 apps online: ${other:-none}
  Free the port, or pick another:  PORT=<free-port> bash deploy.sh"
}

# Decide which port to run on. Sets PORT.
resolve_port() {
  local preferred="$1" domain="$2" me="$3" config="$4"
  local routed="" taken=" " host rule_port candidate

  while read -r host rule_port; do
    [ -z "$rule_port" ] && continue
    [ "$host" = "$domain" ] && routed="$rule_port"
    taken="$taken$rule_port "
  done < <(tunnel_rules "$config")

  # 1. An explicit PORT= is an instruction, not a hint. Honour it and check it.
  if [ -n "${PORT_REQUESTED:-}" ]; then
    PORT="$PORT_REQUESTED"
    assert_port_available "$PORT" "$me"
    info "Port $PORT (set explicitly)"
    return
  fi

  # 2. Already routed: that rule decides, so a redeploy stays put.
  if [ -n "$routed" ]; then
    PORT="$routed"
    assert_port_available "$PORT" "$me"
    info "Port $PORT (from the existing $domain tunnel rule)"
    return
  fi

  # 3. Nothing routed yet: preferred port, else the next one free on both
  #    counts — not listening, and not promised to another hostname.
  for candidate in $(seq "$preferred" $((preferred + 60))); do
    case "$taken" in *" $candidate "*) continue ;; esac
    port_is_ours_or_free "$candidate" "$me" || continue
    PORT="$candidate"
    [ "$candidate" = "$preferred" ] && info "Port $PORT" \
      || info "Port $preferred is taken — using $PORT instead"
    return
  done
  error "No free port in $preferred..$((preferred + 60)). Check: ss -ltnp"
}

# Every hostname this tunnel serves, and whether anything is answering on it.
# Read from the cloudflared config rather than a list kept in these scripts —
# a hand-maintained table is exactly the thing that goes quietly out of date.
print_routes() {
  local config="$1" domain="$2"
  if [ -z "$config" ] || [ ! -f "$config" ]; then
    warn "No cloudflared config found — cannot list the routes."
    return
  fi
  PM2_JSON="$(pm2 jlist 2>/dev/null || echo '[]')" \
  LISTENERS="$(ss -ltnp 2>/dev/null || true)" \
  python3 - "$config" "$domain" <<'PYEOF'
import json, os, re, sys

config, current = sys.argv[1], sys.argv[2]
GREEN, YELLOW, DIM, BOLD, NC = "\033[0;32m", "\033[1;33m", "\033[2m", "\033[1m", "\033[0m"

rules = []
for host, svc in re.findall(r"-\s*hostname:\s*(\S+)\s*\n\s*service:\s*(\S+)",
                            open(config).read()):
    m = re.search(r":(\d+)\s*$", svc)
    rules.append((host, m.group(1) if m else "?"))

# port -> pid, from the listening sockets
listening = {}
for line in os.environ.get("LISTENERS", "").splitlines():
    addr = re.search(r"\s(\S+):(\d+)\s", line)
    pid = re.search(r"pid=(\d+)", line)
    if addr:
        listening[addr.group(2)] = pid.group(1) if pid else ""

# pid -> pm2 name
try:
    procs = json.loads(os.environ.get("PM2_JSON") or "[]")
except Exception:
    procs = []
by_pid = {str(p.get("pid")): p.get("name", "") for p in procs if p.get("pid")}
by_name = {p.get("name", ""): p.get("pm2_env", {}).get("status", "") for p in procs}

rows = []
for host, port in rules:
    pid = listening.get(port)
    if pid is None:
        state, app = "not running", "—"
    else:
        app = by_pid.get(pid, "")
        state = by_name.get(app, "online") if app else "online"
        app = app or "(not pm2)"
    rows.append((host, port, state, app, host == current))

if not rows:
    print("  (no hostname rules in the tunnel config)")
    sys.exit()

w_host = max(6, max(len(r[0]) for r in rows))
w_app = max(3, max(len(r[3]) for r in rows))
w_state = max(6, max(len(r[2]) for r in rows))
line = "  " + "─" * (w_host + w_app + w_state + 17)

print()
print(f"  {BOLD}Cloudflare Tunnel routes{NC}  {DIM}({config}){NC}")
print(line)
print(f"  {BOLD}{'DOMAIN'.ljust(w_host)}  {'PORT'.rjust(5)}  {'STATUS'.ljust(w_state + 2)}  {'PM2'.ljust(w_app)}{NC}")
print(line)
for host, port, state, app, is_me in rows:
    dot = f"{GREEN}●{NC}" if state == "online" else f"{YELLOW}○{NC}"
    here = f"  {GREEN}← this app{NC}" if is_me else ""
    print(f"  {host.ljust(w_host)}  {port.rjust(5)}  {dot} {state.ljust(w_state)}  {app.ljust(w_app)}{here}")
print(line)
PYEOF
}

step "Port"
command -v ss >/dev/null 2>&1 || warn "'ss' not found (install iproute2) — cannot verify a port is free."
CF_CONFIG="$(find_cf_config)"
resolve_port "$PREFERRED_PORT" "$DOMAIN" "$APP_NAME" "$CF_CONFIG"

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

# ── 4. Environment validation ─────────────────────────────────────────────────
step "Environment"
ENV_FILE="$APP_DIR/.env.local"
[ -f "$ENV_FILE" ] || error ".env.local not found at $ENV_FILE\n\n  cp $APP_DIR/.env.local.example $ENV_FILE  &&  nano $ENV_FILE"

# Read KEY from .env.local, then backend/.env (override), trimming quotes.
# Mirrors app/config.py: env_file=("../.env.local", ".env").
envget() {
  local v="" f line
  for f in "$ENV_FILE" "$BACKEND_DIR/.env"; do
    [ -f "$f" ] || continue
    line=$(grep -E "^$1=" "$f" | tail -1 || true)
    [ -n "$line" ] && v=$(printf '%s' "${line#*=}" | sed -E 's/^["'\'']//; s/["'\'']$//')
  done
  printf '%s' "$v"
}

# Required.
BASE_URL_V=$(envget BASE_URL)
SESSION_V=$(envget SESSION_SECRET)
CID=$(envget GOOGLE_CLIENT_ID)
CSEC=$(envget GOOGLE_CLIENT_SECRET)
JWT=$(envget JWT_SECRET)

missing=()
[ -z "$BASE_URL_V" ] && missing+=("BASE_URL")
[ -z "$CID" ]        && missing+=("GOOGLE_CLIENT_ID")
[ -z "$CSEC" ]       && missing+=("GOOGLE_CLIENT_SECRET")
[ -z "$JWT" ]        && missing+=("JWT_SECRET")
[ -z "$SESSION_V" ]  && missing+=("SESSION_SECRET")
if [ ${#missing[@]} -gt 0 ]; then
  error "Missing required keys in .env.local:\n    - $(printf '%s\n    - ' "${missing[@]}" | sed '$s/    - $//')\n  See $APP_DIR/.env.local.example."
fi

# Non-fatal sanity checks.
[[ "$BASE_URL_V" == *localhost* ]] && warn "BASE_URL is localhost — set it to https://$DOMAIN for the live site."
[[ "$BASE_URL_V" == */ ]]          && warn "BASE_URL has a trailing slash — backend strips it, but Google's redirect URI must match exactly."
[[ "$JWT" == change-me* || "$JWT" == your-* || "$SESSION_V" == change-me* || "$SESSION_V" == your-* ]] && \
  warn "JWT_SECRET/SESSION_SECRET still looks like a placeholder — set real random values."

PROV=$(envget AI_PROVIDER); PROV=${PROV:-opencode}
case "$PROV" in
  claude) [ -z "$(envget ANTHROPIC_API_KEY)" ] && warn "AI_PROVIDER=claude but ANTHROPIC_API_KEY is unset (chain will fall back)." ;;
  gemini) [ -z "$(envget GEMINI_API_KEY)" ]    && warn "AI_PROVIDER=gemini but GEMINI_API_KEY is unset (chain will fall back)." ;;
esac
# Register https://$DOMAIN/auth/google/callback as an authorized redirect URI in Google Console.
info ".env.local validated (provider=$PROV, base_url=$BASE_URL_V)"

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
# Already located during the port step.
if [ -z "$CF_CONFIG" ]; then
  warn "cloudflared config not found. Ensure this ingress rule exists:"
  echo "    - hostname: $DOMAIN"
  echo "      service: http://localhost:$PORT"
else
  ROUTE=$(check_tunnel_route "$CF_CONFIG" "$DOMAIN" "$PORT")
  case "$ROUTE" in
    OK)
      info "$DOMAIN → localhost:$PORT already routed — no change needed" ;;
    CLASH*)
      error "Port $PORT is already routed to ${ROUTE#CLASH } in $CF_CONFIG.
  Adding $DOMAIN on the same port would give two hostnames one app.
  Pick a free port:  PORT=<free-port> bash deploy.sh" ;;
    WRONGPORT*)
      error "$DOMAIN is routed to ${ROUTE#WRONGPORT } in $CF_CONFIG, not port $PORT.
  This deploy would look successful while the tunnel kept serving the old app.
  Fix the rule by hand, or deploy on that port:  PORT=<that-port> bash deploy.sh" ;;
    MISSING)
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
      info "Added $DOMAIN → localhost:$PORT (existing rules untouched; backup at ${CF_CONFIG}.bak)"
      systemctl is-active --quiet cloudflared 2>/dev/null && sudo systemctl restart cloudflared && info "cloudflared restarted" \
        || warn "Restart cloudflared manually: sudo systemctl restart cloudflared"
      warn "Ensure DNS for $DOMAIN points at this tunnel:"
      echo "    cloudflared tunnel route dns <TUNNEL_NAME> $DOMAIN" ;;
  esac
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
print_routes "$CF_CONFIG" "$DOMAIN"

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

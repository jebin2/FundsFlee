#!/usr/bin/env bash
# Runs the full Phase-2 parity harness — both sides of both checks:
#   1. Serialization parity (TS + Python, offline)
#   2. Live read parity   (TS + Python, real sheet — needs one backend sign-in)
#
# Usage: ./parity/run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$HOME/.pyenv/versions/backend_env/bin/python"
[ -x "$PY" ] || PY=python3

cd "$ROOT"

echo "━━ 1/2 Serialization parity ━━━━━━━━━━━━━━━━━━━━━━━━"
echo "→ TS side (vitest)"
npx vitest run parity/serialization.spec.ts --silent
echo "→ Python side (+ diff)"
(cd backend && "$PY" scripts/parity_serialization.py)

echo
echo "━━ 2/2 Live read parity ━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ ! -f backend/data/users.json ]; then
    echo "⚠ skipped — no backend sign-in yet."
    echo "  Start the backend:  cd backend && uvicorn app.main:app --port 8000"
    echo "  Sign in:            http://localhost:8000/auth/login"
    echo "  Then re-run:        ./parity/run.sh"
    exit 0
fi

echo "→ fetching Google token from backend user store"
eval "$(cd backend && "$PY" scripts/parity_live.py --print-token)"
export PARITY_ACCESS_TOKEN PARITY_SHEET_ID

echo "→ TS side: dumping sheet via old data layer (vitest)"
npx vitest run parity/live.spec.ts --silent

echo "→ Python side: dumping sheet via new data layer + diff"
(cd backend && "$PY" scripts/parity_live.py)

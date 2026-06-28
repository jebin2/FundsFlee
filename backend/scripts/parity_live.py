"""Live read-parity check — Python side.

Reads the real spending sheet through the NEW Python data layer and writes
parity/py-live.json. If parity/ts-live.json exists (from `npm test`
parity/live.spec.ts), diffs the two.

Prerequisites: sign in once via the Python backend so data/users.json holds
Google credentials.

Usage:
    cd backend
    python scripts/parity_live.py                 # dump + diff
    python scripts/parity_live.py --print-token   # token + sheet id for the TS side
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.auth import google_auth, user_store          # noqa: E402
from app.sheets import (                                    # noqa: E402
    get_all_transactions,
    get_categories,
    get_meta_values,
)
from scripts.parity_serialization import diff               # noqa: E402

PARITY_DIR = Path(__file__).resolve().parents[2] / "parity"


async def resolve_session() -> tuple[str, str]:
    users = list(user_store._users.values())
    if not users:
        sys.exit("no users in data/users.json — sign in via the backend first")
    user = users[0]
    token = await google_auth.get_google_access_token(user["user_id"])
    if not token:
        sys.exit("could not refresh Google access token — re-login via the backend")
    sheet_id = user.get("sheet_id")
    if not sheet_id:
        sys.exit("user record has no sheet_id")
    return token, sheet_id


async def main() -> int:
    token, sheet_id = await resolve_session()

    if "--print-token" in sys.argv:
        print(f"export PARITY_ACCESS_TOKEN='{token}'")
        print(f"export PARITY_SHEET_ID='{sheet_id}'")
        return 0

    output = {
        "transactions": await get_all_transactions(token, sheet_id),
        "categories": await get_categories(token, sheet_id),
        "meta_keys": sorted((await get_meta_values(token, sheet_id)).keys()),
    }
    output = json.loads(json.dumps(output))
    (PARITY_DIR / "py-live.json").write_text(json.dumps(output, indent=2, ensure_ascii=False))
    print(f"wrote {PARITY_DIR / 'py-live.json'} "
          f"({len(output['transactions'])} transactions, {len(output['categories'])} categories)")

    ts_path = PARITY_DIR / "ts-live.json"
    if not ts_path.exists():
        print("parity: ts-live.json not found — run the TS side:")
        print("  eval $(python scripts/parity_live.py --print-token) && cd .. && npx vitest run parity/live.spec.ts")
        return 0

    problems = diff(output, json.loads(ts_path.read_text()))
    if problems:
        print(f"\n✗ LIVE PARITY FAILURE — {len(problems)} difference(s):")
        for p in problems[:50]:
            print(f"  {p}")
        return 1
    print("✓ live parity OK — Python reads match TS reads")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

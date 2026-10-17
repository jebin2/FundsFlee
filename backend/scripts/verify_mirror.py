#!/usr/bin/env python
"""Compare the local SQLite mirror against the Google Sheet.

    python scripts/verify_mirror.py

Reads only — it never writes to either store. A drift audit: the sheet is a
one-way mirror of the local database, so a difference means a hand-edit, a
push that has not gone out yet, or a bug in app/db/sync.

Exits non-zero when anything differs.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.cron_store import load_cron_session          # noqa: E402
from app.core.google_oauth import refresh_google_token     # noqa: E402
from app.db.verify import verify                           # noqa: E402


async def main() -> int:
    stored = load_cron_session()
    if not stored:
        print("No stored credentials — open the app once so it registers.")
        return 2

    access_token = await refresh_google_token(stored["refreshToken"])
    if not access_token:
        print("Could not refresh the Google access token.")
        return 2

    result = await verify(access_token, stored["sheetId"])
    if "reason" in result:
        print(result["reason"])
        return 2

    width = max(len(name) for name in result["tabs"])
    for name, tab in result["tabs"].items():
        mark = "ok " if tab["ok"] else "DIFF"
        print(f"{mark} {name:<{width}}  sheet={tab['sheetRows']:<6} "
              f"local={tab['localRows']:<6} differences={tab['differences']}")
        for entry in tab["sample"]:
            cols = entry.get("columns")
            detail = f" ({', '.join(cols)})" if cols else ""
            print(f"       row {entry['row']}: {entry['problem']}{detail}")

    print()
    print("MATCH — the sheet reproduces the local database." if result["ok"]
          else "MISMATCH — the sheet has drifted (or a push is still pending).")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

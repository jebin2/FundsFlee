#!/usr/bin/env python
"""Compare the local SQLite mirror against the Google Sheet.

    python scripts/verify_mirror.py

Reads only — it never writes to either store. Run it after using the app for a
while: if every tab matches, dual-write is working and reads can move to the
mirror.

Exits non-zero when anything differs, so it can gate the next phase.
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
    print("MATCH — the mirror reproduces the sheet." if result["ok"]
          else "MISMATCH — do not move reads over yet.")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

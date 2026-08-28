#!/usr/bin/env python
"""Take a backup right now, without waiting for 03:30.

    python scripts/backup_now.py

Use it to check the job works before trusting it, and before anything risky —
a schema change, a restore, a migration.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.backup import run_backup_sync   # noqa: E402


def main() -> int:
    result = run_backup_sync()
    path = Path(result["file"])
    print(f"wrote {path}  ({path.stat().st_size // 1024} KB)")
    for sheet_id, counts in result["counts"].items():
        rows = ", ".join(f"{tab}={n}" for tab, n in counts.items() if n)
        print(f"  {sheet_id[:12]}…  {rows or 'empty'}")
    if result["pruned"]:
        print(f"pruned {result['pruned']} old archive(s)")
    print("\nRestore: stop the app, unpack over backend/data/, start it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

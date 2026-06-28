"""Python side of the Phase-2 parity harness.

Writes parity/py-output.json from shared fixtures; if parity/ts-output.json
exists (produced by `npm test` running parity/serialization.spec.ts), diffs
both sides and exits non-zero on mismatch.

Usage:  cd backend && python scripts/parity_serialization.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.sheets.transaction_schema import (  # noqa: E402
    is_deleted_row,
    row_to_transaction,
    transaction_to_row,
    transaction_update_to_cells,
)

PARITY_DIR = Path(__file__).resolve().parents[2] / "parity"
FIXED_NOW = "2026-06-13T12:00:00.000Z"


def build_output() -> dict:
    fixtures = json.loads((PARITY_DIR / "fixtures.json").read_text())
    return {
        "to_row": [transaction_to_row(tx) for tx in fixtures["transactions"]],
        "roundtrip": [
            row_to_transaction(transaction_to_row(tx)) for tx in fixtures["transactions"]
        ],
        "from_raw": [
            {
                "name": f["name"],
                "transaction": row_to_transaction(f["row"]),
                "is_deleted": is_deleted_row(f["row"]),
            }
            for f in fixtures["raw_rows"]
        ],
        "update_cells": [
            transaction_update_to_cells({"merchant": "Zomato", "amount": 12.5}, 7, FIXED_NOW),
            transaction_update_to_cells({"deleted": True}, 42, FIXED_NOW),
            transaction_update_to_cells(
                {"is_duplicate": False, "tags": ["x", "y"], "notes": None}, 3, FIXED_NOW
            ),
        ],
    }


def diff(a, b, path="$") -> list[str]:
    problems: list[str] = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                problems.append(f"{path}.{k}: only in TS ({b[k]!r})")
            elif k not in b:
                problems.append(f"{path}.{k}: only in Python ({a[k]!r})")
            else:
                problems += diff(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            problems.append(f"{path}: length {len(a)} (py) != {len(b)} (ts)")
        for i, (x, y) in enumerate(zip(a, b)):
            problems += diff(x, y, f"{path}[{i}]")
    elif a != b or type(a) is not type(b) and not (
        isinstance(a, (int, float)) and isinstance(b, (int, float)) and a == b
    ):
        problems.append(f"{path}: py={a!r} ts={b!r}")
    return problems


def main() -> int:
    output = build_output()
    # Round-trip through JSON so types match what TS produced via JSON.stringify
    output = json.loads(json.dumps(output))
    (PARITY_DIR / "py-output.json").write_text(json.dumps(output, indent=2, ensure_ascii=False))
    print(f"wrote {PARITY_DIR / 'py-output.json'}")

    ts_path = PARITY_DIR / "ts-output.json"
    if not ts_path.exists():
        print("parity: ts-output.json not found — run `npm test` (serialization.spec.ts) and re-run")
        return 0

    ts = json.loads(ts_path.read_text())
    problems = diff(output, ts)
    if problems:
        print(f"\n✗ PARITY FAILURE — {len(problems)} difference(s):")
        for p in problems[:50]:
            print(f"  {p}")
        return 1
    print("✓ parity OK — Python output matches TS output")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Duplicate detection — port of src/lib/ai/dedup.ts."""
import json

from app.ai.client import generate_text
from app.ai.parse_json import try_parse_ai_json


async def find_duplicates(transactions: list[dict]) -> list[dict]:
    # Group by date — only dates with 2+ transactions can have duplicates
    by_date: dict[str, list[dict]] = {}
    for tx in transactions:
        by_date.setdefault(tx["date"], []).append(tx)

    results: list[dict] = []

    for date_key, txs in by_date.items():
        if len(txs) < 2:
            continue

        payload = json.dumps(
            [{
                "id": t["id"],
                "merchant": t["merchant"],
                "item_name": t.get("item_name") or "",
                "amount": t["amount"],
                "source": t.get("source"),
                "notes": t.get("notes") or "",
            } for t in txs],
            separators=(",", ":"),
            ensure_ascii=False,
        )

        raw = await generate_text(
            f"""Find duplicate transactions within this single day: {date_key}

Transactions (id, merchant, item_name, amount, source, notes):
{payload}

A duplicate means the same real-world payment recorded more than once (e.g. from both a receipt scan and a bank email, or from two bank alerts for the same UPI transaction).

Rules:
1. Same merchant (fuzzy — "OPEN MART" = "OPENMART") AND same amount → duplicate.
2. Same merchant AND amount within ₹30 AND one source is "email" or "shortcut" → likely duplicate (bank alert may show net amount while payment app shows gross).
3. Notes contain the same UPI ref / bank ref number → duplicate regardless of merchant spelling or minor amount difference.
4. item_name is often empty for email imports — do NOT require matching item_name for cross-source duplicates.
5. "Unknown" merchant with amount=0 → NOT a duplicate unless notes match.
6. Pick the entry with the most detail (receipt > email > shortcut) as original_id; if equal, pick earliest time.
7. Return [] if no duplicates found.

Respond with JSON only:
[{{"original_id":"...","duplicate_ids":["..."],"reason":"..."}}]""",
            "",
            768,
        )

        groups = try_parse_ai_json(raw, "array")
        if not groups:
            continue
        results.extend(g for g in groups if g.get("duplicate_ids"))

    return results

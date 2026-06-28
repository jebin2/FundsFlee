"""Duplicate-merge field picker — port of src/lib/ai/merge-transactions.ts."""
import json

from app.ai.client import generate_text
from app.ai.parse_json import try_parse_ai_json


async def merge_transactions(transactions: list[dict]) -> dict:
    payload = json.dumps(
        [{
            "id": t["id"],
            "source": t.get("source"),
            "date": t["date"],
            "time": t["time"],
            "amount": t["amount"],
            "merchant": t["merchant"],
            "category": t["category"],
            "subcategory": t.get("subcategory") or "",
            "item_name": t.get("item_name") or "",
            "payment_method": t["payment_method"],
            "notes": t.get("notes") or "",
            "raw_input": t.get("raw_input") or "",
            "receipt_url": t.get("receipt_url") or "",
        } for t in transactions],
        indent=2,
        ensure_ascii=False,
    )

    raw = await generate_text(
        f"""These are duplicate records of the same real-world payment. Merge them into one best transaction.

Entries ({len(transactions)}):
{payload}

Rules for picking the best value of each field:
- amount: prefer "receipt" source; if amounts differ within ₹30, use the receipt value
- time: prefer non-"00:00" (exact time) over "00:00" (email/shortcut default)
- merchant: prefer properly-cased name over ALL-CAPS; avoid "Unknown"
- category / subcategory: prefer the most specific non-"Others" value
- item_name: prefer the most descriptive non-empty value
- payment_method: prefer non-"Other" value
- notes: combine unique information from all entries separated by " | "; keep UPI refs
- receipt_url: keep if any entry has one (prefer non-empty)
- raw_input: keep the most informative value

Return ONLY a JSON object with the merged field values (no id, no source, no status):
{{
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "amount": number,
  "merchant": "string",
  "category": "string",
  "subcategory": "string or empty",
  "item_name": "string or empty",
  "payment_method": "UPI|Cash|Card|NetBanking|Other",
  "notes": "string or empty",
  "receipt_url": "string or empty"
}}""",
        "",
        512,
    )

    merged = try_parse_ai_json(raw, "object")
    if not merged:
        raise ValueError("AI returned invalid merge response")
    return merged

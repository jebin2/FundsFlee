"""Notes field extractor — port of src/lib/ai/parse-notes.ts."""
from app.ai.client import generate_text
from app.ai.parse_json import try_parse_ai_json


async def extract_from_notes(entries: list[dict]) -> dict:
    if len(entries) == 0:
        return {}

    lines = "\n".join(
        f'{i + 1}. id="{e.get("tx_id")}" item="{e.get("item_name") or ""}" '
        f'notes="{e.get("notes")}" existing_qty="{e.get("quantity") or ""}" '
        f'existing_merchant="{e.get("merchant") or ""}"'
        for i, e in enumerate(entries)
    )

    raw = await generate_text(
        f"""Extract structured fields from the notes of these transactions. Notes are free-text written by a user about a purchase.

Transactions:
{lines}

For each transaction, extract from the notes ONLY if not already set in existing fields:
- item_name: more specific product name (e.g. "full fat milk" → "Full Fat Milk", only if different from current)
- quantity: amount purchased (e.g. "2 packets", "500g", "1 litre")
- merchant: shop or brand name (e.g. "from Nandini", "at Big Bazaar")

Rules:
- Only suggest a field if you find it clearly in the notes
- Do NOT suggest if the existing value already covers it
- Return empty object {{}} for a tx_id if nothing useful is found
- merchant should be a proper noun (shop/brand), not a description

Respond with JSON only:
{{
  "{{tx_id}}": {{
    "item_name": "..." or omit,
    "quantity": "..." or omit,
    "merchant": "..." or omit
  }},
  ...
}}""",
        "",
        1024,
    )

    return try_parse_ai_json(raw) or {}

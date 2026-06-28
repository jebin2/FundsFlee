"""Text transaction parser — port of src/lib/ai/parse-text.ts."""
from app.ai.client import generate_text
from app.ai.parse_json import parse_ai_json
from app.core.dates import today_iso

SYSTEM_PROMPT = """You are a transaction parser for an Indian spending tracker. Extract spending details from SMS, email, pasted text, or receipt images.

Always respond with valid JSON matching this schema exactly:
{
  "merchant": string,
  "amount": number (total in INR — sum of all items, or transaction total),
  "currency": "INR",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "category": string (one of: Food & Dining, Transport, Shopping, Entertainment, Health, Bills & Utilities, Education, Personal Care, Gifts & Donations, Others),
  "subcategory": string or null,
  "items": [
    {
      "name": string,
      "qty": number,
      "unit": string or null (kg, g, L, ml, pcs, etc.),
      "price": number (total for this line = qty × unit_price),
      "unit_price": number or null (price per single unit if qty > 1),
      "category": string or null (item-specific category if different from overall)
    }
  ],
  "payment_method": one of: Cash, UPI, Card, NetBanking, Other,
  "notes": string or null,
  "confidence": number 0-1,
  "uncertain_fields": array of field names that are uncertain
}

Rules:
- If date is missing, use today's date; if time is missing, use "00:00"
- Extract EVERY line item visible (receipt lines, order items, etc.); if none, return items as []
- For UPI/bank SMS: "debited", "paid", "transferred" are expenses; merchant is the payee, not the bank
- For credit card SMS: look for "spent", "transaction", "purchase"
- amount = sum of all item prices, or the transaction total when items are not itemised
- confidence = 1.0 means everything is clear; lower if key fields are guessed"""


async def parse_transaction_text(
    text: str,
    user_region: str | None = None,
    today_date: str | None = None,
) -> dict:
    user_context = " ".join(
        p for p in [
            f"User is in {user_region}." if user_region else "",
            f"Today's date is {today_date}." if today_date else f"Today's date is {today_iso()}.",
        ] if p
    )

    raw = await generate_text(
        f"{user_context}\n\nParse this text:\n\n{text}",
        SYSTEM_PROMPT,
        1024,
    )

    return parse_ai_json(raw)

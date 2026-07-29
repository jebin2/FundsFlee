"""Bundle parser — one email plus all of its attachments, in a single AI call.

An email and its attachments almost always describe ONE payment. A Zomato order
arrives as a body plus three PDFs (order summary, the restaurant's tax invoice,
and the platform's fee invoice) whose amounts differ — ₹426.11, ₹360.15, ₹17.58
for a single ₹426.11 order. Parsing each in isolation triples the spend, and no
duplicate check can recover it: the amounts and the legal-entity merchant names
genuinely differ.

So the whole bundle goes to the model at once and the prompt makes the merge its
job. Bank statements are the one case that really is many payments, which the
model reports back as doc_type.

Emails with no attachments keep using parse_email.parse_email_transaction — the
proven single-body path — so this only runs when there is something to merge.
"""
import time

from app.ai.client import generate_text
from app.ai.parse_email import validate_transaction
from app.ai.parse_json import try_parse_ai_json
from app.core.logger import log

# Per-unit budgets. A flat cap would decapitate a statement while leaving a
# short body untouched; the email cap matches parse_email's existing 4000.
MAX_EMAIL_CHARS = 4_000
MAX_DOC_CHARS = 20_000
MAX_TOTAL_CHARS = 60_000

BUNDLE_SYSTEM_PROMPT = """You are a financial transaction extractor for Indian payment emails and their attached documents.

You receive one email and every document attached to it. Together they usually describe ONE real payment — not several.

Merge, do not multiply:
- An order summary, the merchant's tax invoice, and the platform's fee invoice are three views of the SAME payment. Report it once.
- Use the amount the customer was actually charged (the order total / amount debited). Never sum the component invoices, and never report a component invoice on its own.
- When documents disagree, the amount in the email body or the order summary wins over an individual tax invoice.

The ONE exception — bank and card statements:
- A statement lists many distinct payments. Emit one transaction per debit row.
- Set doc_type to "statement" in that case; otherwise "purchase".

Extract ONLY debits — money leaving the user's account. Ignore credits, refunds, incoming transfers, balance alerts, reward points, and promotional content.

Field rules:
- amount: actual amount PAID/DEBITED in INR (positive number). Never use "available balance", MRP, "you saved", or reward points.
- merchant: the payee/store the user would recognise. Clean up noise: "UPI/SWIGGY/123456" → "Swiggy", "POS/AMAZON.IN" → "Amazon", VPA "zomato@upi" → "Zomato". Prefer the consumer brand over the legal entity — "Nandhana Palace", not "NANDHANA FOODS PRIVATE LIMITED". For person-to-person transfers (NEFT/IMPS/RTGS), use the recipient name.
- category: one of — Food & Dining, Transport, Shopping, Entertainment, Health, Bills & Utilities, Education, Personal Care, Gifts & Donations, Others.
- payment_method: UPI | Card | NetBanking | Cash | Other.
- date: YYYY-MM-DD. The transaction date, not the email received date.
- time: HH:MM 24h. Use "00:00" if absent.
- item_name: specific product/service purchased. Examples: "Nandhana Palace Order #8407112492", "Airtel Mobile Recharge", "Electricity Bill May 2026". Omit (null) when nothing specific is identifiable.
- notes: transaction/order/reference ID or any other useful detail not captured elsewhere. Omit (null) if nothing useful.
- confidence: 0–1. Set below 0.65 if amount, merchant, or date is ambiguous.
- uncertain_fields: array of field names you are unsure about, e.g. ["date", "merchant"].

Return {"doc_type":"purchase","transactions":[]} when there is no debit to report — promotional email, newsletter, credit/refund, no clear amount, merchant undeterminable, or confidence below 0.65.

Respond with valid JSON only — no markdown fences, no explanation:
{
  "doc_type": "purchase" | "statement",
  "transactions": [
    {
      "amount": number,
      "merchant": string,
      "category": string,
      "payment_method": string,
      "date": "YYYY-MM-DD",
      "time": "HH:MM",
      "item_name": string | null,
      "notes": string | null,
      "confidence": number,
      "uncertain_fields": string[]
    }
  ]
}"""


def build_bundle_prompt(units: list[dict], region: str, today_date: str) -> str:
    parts: list[str] = []
    if region:
        parts.append(f"User is in {region}.")
    parts.append(f"Today's date is {today_date}.")

    for unit in units:
        if unit["kind"] == "email":
            parts.append(f"From: {unit.get('from', '')}")
            parts.append(f"Subject: {unit.get('subject', '')}")
            parts.append("--- EMAIL BODY ---")
            parts.append(unit["text"][:MAX_EMAIL_CHARS])
        elif unit["kind"] == "document":
            label = unit.get("source") or "attachment"
            note = " (truncated)" if unit.get("truncated") else ""
            parts.append(f"--- ATTACHED DOCUMENT: {label}{note} ---")
            parts.append(unit["text"][:MAX_DOC_CHARS])

    return "\n".join(parts)[:MAX_TOTAL_CHARS]


async def parse_email_bundle(
    units: list[dict],
    region: str,
    today_date: str,
) -> dict:
    """Returns {"transactions": [...], "docType": str, "skipReason": str|None}.

    Every row still goes through parse_email's validation gauntlet — the model
    returning JSON is not evidence the JSON is sane.
    """
    t0 = time.time()
    # An email unit is worth sending even with an empty body — a statement mail
    # is often just a subject line plus the attachment, and From/Subject are
    # real signal for the model.
    parseable = [
        u for u in units
        if (u["kind"] == "document" and u.get("text"))
        or (u["kind"] == "email" and (u.get("text") or u.get("subject")))
    ]
    if not parseable:
        log.warn("bundle", "no parseable units — nothing sent to AI",
                 {"units": len(units), "kinds": ",".join(sorted({u["kind"] for u in units})) or "none"})
        return {"transactions": [], "docType": "purchase", "skipReason": "nothing_to_parse"}

    prompt = build_bundle_prompt(parseable, region, today_date)
    head = next((u for u in parseable if u["kind"] == "email"), {})
    docs = [u for u in parseable if u["kind"] == "document"]

    log.info("bundle", "parsing", {
        "from": str(head.get("from", ""))[:80],
        "subject": str(head.get("subject", ""))[:80],
        "emailUnits": len(parseable) - len(docs),
        "docUnits": len(docs),
        "docs": ",".join(d.get("source") or "?" for d in docs) or "-",
        "promptChars": len(prompt),
    })

    try:
        raw = await generate_text(prompt, BUNDLE_SYSTEM_PROMPT, 4096)
    except Exception as err:
        log.error("bundle", "ai call failed", err, {"promptChars": len(prompt),
                                                    "ms": int((time.time() - t0) * 1000)})
        return {"transactions": [], "docType": "purchase", "skipReason": "parse_error"}

    ai_ms = int((time.time() - t0) * 1000)
    parsed = try_parse_ai_json(raw)
    if not isinstance(parsed, dict):
        log.warn("bundle", "AI response was not a JSON object",
                 {"ms": ai_ms, "rawChars": len(raw), "rawHead": raw[:160].replace("\n", " ")})
        return {"transactions": [], "docType": "purchase", "skipReason": "ai_null"}

    doc_type = parsed.get("doc_type") if parsed.get("doc_type") in ("purchase", "statement") else "purchase"
    if parsed.get("doc_type") not in ("purchase", "statement"):
        log.warn("bundle", "unrecognised doc_type — treating as purchase",
                 {"docType": str(parsed.get("doc_type"))[:40]})

    rows = parsed.get("transactions")
    if not isinstance(rows, list) or not rows:
        log.info("bundle", "AI reported no debit to record", {"docType": doc_type, "ms": ai_ms})
        return {"transactions": [], "docType": doc_type, "skipReason": "ai_null"}

    log.info("bundle", "AI returned rows", {"docType": doc_type, "rows": len(rows), "ms": ai_ms})

    valid: list[dict] = []
    dropped: list[str] = []
    for r in rows:
        tx = validate_transaction(r, today_date) if isinstance(r, dict) else None
        if tx:
            valid.append(tx)
        else:
            dropped.append(f"{(r or {}).get('merchant', '?')}/{(r or {}).get('amount', '?')}"
                           if isinstance(r, dict) else "non-object")
    if dropped:
        log.warn("bundle", "rows failed validation", {"dropped": len(dropped),
                                                      "kept": len(valid),
                                                      "rejected": "; ".join(dropped[:8])})
    if not valid:
        return {"transactions": [], "docType": doc_type, "skipReason": "validation_failed"}

    # A "purchase" bundle describes one payment; more than one row means the
    # model multiplied the component invoices after all. Keep the largest —
    # the customer-facing total always exceeds any single component.
    if doc_type == "purchase" and len(valid) > 1:
        log.warn("bundle", "purchase returned multiple rows — collapsing to the largest",
                 {"rows": len(valid), "amounts": ",".join(str(t["amount"]) for t in valid)})
        valid = [max(valid, key=lambda t: t["amount"])]

    log.info("bundle", "done", {
        "docType": doc_type,
        "rows": len(valid),
        "amounts": ",".join(str(t["amount"]) for t in valid[:12]),
        "merchants": " | ".join(t["merchant"] for t in valid[:6]),
        "ms": int((time.time() - t0) * 1000),
    })
    return {"transactions": valid, "docType": doc_type, "skipReason": None}

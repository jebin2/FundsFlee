"""The single parser. Every entry point normalises to units and lands here.

Before this there were five system prompts and five parse functions, and the
validation gauntlet ran in only two of them — a statement row claiming ₹5,000,000
or dated 2019 went into the sheet unchecked while the same row from an email was
rejected. One prompt, one validator, one place to fix a bug.

    gmail message ─┐
    pdf upload     ├─ units ─→ parse_units ─→ validate ─→ rows
    image upload   │
    text / SMS    ─┘

Units come from extract.pipeline (or are built directly for raw text). Text units
go down the text chain; image units go down the image chain, one call per page.
Consumers differ only in what they do with the result: the receipt flow expands
items into a row each, the email flow folds them onto one transaction.
"""
import time
from datetime import date, timedelta

from app.ai.client import generate_text, generate_with_image
from app.ai.parse_json import try_parse_ai_json
from app.core.logger import log
from app.services.expand_items import item_quantity

MAX_EMAIL_CHARS = 4_000
MAX_DOC_CHARS = 20_000
MAX_TOTAL_CHARS = 60_000

# Automatic imports must be conservative; an interactive scan the user is
# watching should hand back whatever it found and let them correct it.
CONFIDENCE_FLOOR = 0.65
NO_FLOOR = 0.0

MAX_AMOUNT = 500_000
VALID_PAYMENT_METHODS = ["Cash", "UPI", "Card", "NetBanking", "Other"]
VALID_CATEGORIES = [
    "Food & Dining", "Transport", "Shopping", "Entertainment", "Health",
    "Bills & Utilities", "Education", "Personal Care", "Gifts & Donations", "Others",
]

SYSTEM_PROMPT = """You are a transaction extractor for an Indian spending tracker. You receive any mix of: an email body, documents attached to it (order summaries, tax invoices, bank statements), pasted text or an SMS, or photographed/scanned pages.

Together they usually describe ONE real payment — not several.

Merge, do not multiply:
- An order summary, the merchant's tax invoice, and the platform's fee invoice are three views of the SAME payment. Report it once.
- Use the amount the customer was actually charged (the order total / amount debited). Never sum the component invoices, and never report a component invoice on its own.
- When documents disagree, the amount in the email body or the order summary wins over an individual tax invoice.

The ONE exception — bank and card statements:
- A statement lists many distinct payments. Emit one transaction per debit row.
- Set doc_type to "statement" in that case; otherwise "purchase".

Extract ONLY debits — money leaving the user's account. Ignore credits, refunds, incoming transfers, balance alerts, reward points, and promotional content.

Field rules:
- amount: actual amount PAID/DEBITED in INR (positive number). Never use "available balance", MRP, "you saved", or reward points. When itemised, this is the total charged, not the sum of item prices if they differ.
- platform: the app or marketplace the order went THROUGH, when there was one — Zomato, Swiggy, Amazon, Flipkart, Blinkit, Zepto, Instamart, Myntra, Uber, Rapido, BookMyShow, and so on. Null when the purchase was direct: in store, on the merchant's own site, or a bank transfer. The merchant stays the restaurant or seller that was actually paid; platform records who processed the order. A Zomato order from Nandhana Palace is merchant "Nandhana Palace", platform "Zomato".
- merchant: the payee/store the user would recognise. Clean up noise: "UPI/SWIGGY/123456" → "Swiggy", "POS/AMAZON.IN" → "Amazon", VPA "zomato@upi" → "Zomato". Prefer the consumer brand over the legal entity — "Nandhana Palace", not "NANDHANA FOODS PRIVATE LIMITED". For person-to-person transfers (NEFT/IMPS/RTGS), use the recipient name.
- category: one of — Food & Dining, Transport, Shopping, Entertainment, Health, Bills & Utilities, Education, Personal Care, Gifts & Donations, Others.
- subcategory: a more specific label when one is obvious, else null.
- payment_method: UPI | Card | NetBanking | Cash | Other. For UPI/bank SMS, "debited"/"paid"/"transferred" are expenses and the merchant is the payee, not the bank. For credit cards look for "spent"/"transaction"/"purchase".
- date: YYYY-MM-DD. The transaction date, not the email received date. If absent, use today's date.
- time: HH:MM 24h. Use "00:00" if absent.
- items: EVERY line item named anywhere — dishes, products, receipt lines. "1 X High Protein - Supreme Boneless Chicken Biryani" becomes {"name":"High Protein - Supreme Boneless Chicken Biryani","qty":1}. Give price only when that line's own price is stated; never split the total yourself. Return [] when nothing is itemised.
- item_name: specific product/service purchased, e.g. "Airtel Mobile Recharge". Leave null when items already covers it.
- notes: transaction/order/reference ID or any other useful detail not captured elsewhere. Omit (null) if nothing useful.
- confidence: 0–1. Set below 0.65 if amount, merchant, or date is ambiguous. 1.0 means everything was clear.
- uncertain_fields: array of field names you are unsure about, e.g. ["date", "merchant"].

Return {"doc_type":"purchase","transactions":[]} when there is no debit to report — promotional email, newsletter, credit/refund, no clear amount, or the merchant cannot be determined.

Respond with valid JSON only — no markdown fences, no explanation:
{
  "doc_type": "purchase" | "statement",
  "transactions": [
    {
      "amount": number,
      "currency": "INR",
      "merchant": string,
      "platform": string | null,
      "category": string,
      "subcategory": string | null,
      "payment_method": string,
      "date": "YYYY-MM-DD",
      "time": "HH:MM",
      "items": [{"name": string, "qty": number, "unit": string | null, "price": number | null, "unit_price": number | null, "category": string | null}],
      "item_name": string | null,
      "notes": string | null,
      "confidence": number,
      "uncertain_fields": string[]
    }
  ]
}"""

# ── Cheap pre-filters (no AI call) ───────────────────────────────────────────
import re  # noqa: E402

_TRANSACTION_SIGNALS = re.compile(
    r"debited|credited|paid|transaction|charged|₹|inr|rs\.|rupee|amount|payment",
    re.IGNORECASE,
)
MIN_BODY_CHARS = 80


def _num(value, default=None):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else default


# ── Validation ───────────────────────────────────────────────────────────────
def _clean_items(raw) -> list[dict]:
    out = []
    for it in raw if isinstance(raw, list) else []:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name") or "").strip()
        if not name:
            continue
        qty = _num(it.get("qty"))
        item = {"name": name, "qty": qty if qty and qty > 0 else 1}
        for key in ("unit", "category"):
            val = it.get(key)
            if isinstance(val, str) and val.strip():
                item[key] = val.strip()
        for key in ("price", "unit_price"):
            val = _num(it.get(key))
            if val is not None:
                item[key] = val
        out.append(item)
    return out


def validate_transaction(raw: dict, today_date: str, min_confidence: float = CONFIDENCE_FLOOR) -> dict | None:
    """The gauntlet every row passes, whatever entry point produced it."""
    amount = _num(raw.get("amount"))
    if amount is None or amount != amount or amount <= 0 or amount > MAX_AMOUNT:
        return None

    # A model that omits confidence has not expressed doubt — treating that as 0
    # would silently discard real payments over a missing field.
    confidence = _num(raw.get("confidence"), 1.0)
    if confidence < min_confidence:
        return None

    merchant = raw.get("merchant")
    merchant = merchant.strip() if isinstance(merchant, str) else ""
    if not merchant or merchant.lower() == "unknown":
        return None

    date_str = raw.get("date") if isinstance(raw.get("date"), str) else ""
    try:
        tx_date = date.fromisoformat(date_str)
        today = date.fromisoformat(today_date)
    except ValueError:
        return None
    try:
        two_years_ago = today.replace(year=today.year - 2)
    except ValueError:  # Feb 29 → Mar 1, matching JS setFullYear
        two_years_ago = today.replace(year=today.year - 2, month=3, day=1)
    # One day of slack: the server clock may trail a user in a timezone ahead.
    if tx_date > today + timedelta(days=1) or tx_date < two_years_ago:
        return None

    pm = raw.get("payment_method")
    cat = raw.get("category")
    raw_time = raw.get("time")
    uncertain = raw.get("uncertain_fields")

    tx: dict = {
        "merchant": merchant,
        "amount": amount,
        "date": date_str,
        "time": raw_time if isinstance(raw_time, str) and re.match(r"^\d{2}:\d{2}$", raw_time) else "00:00",
        "category": cat if cat in VALID_CATEGORIES else "Others",
        "payment_method": pm if pm in VALID_PAYMENT_METHODS else "Other",
        "confidence": confidence,
        "uncertain_fields": [str(f) for f in uncertain] if isinstance(uncertain, list) else [],
        "currency": "INR",
    }
    for key in ("item_name", "notes", "subcategory"):
        val = raw.get(key)
        if isinstance(val, str) and val.strip():
            tx[key] = val.strip()

    # The ordering app goes in tags: the merchant column has to stay the place
    # that was actually paid, or dedup stops matching the same shop across
    # sources — but without this there is no way to total spend per platform.
    platform = raw.get("platform")
    if isinstance(platform, str) and platform.strip():
        tx["tags"] = [platform.strip()]

    items = _clean_items(raw.get("items"))
    if items:
        # Carried raw so consumers can choose: expand to a row each (receipts,
        # which have per-item prices) or fold onto one transaction (emails,
        # which name dishes but rarely price them).
        tx["items"] = items
    return tx


def fold_items(tx: dict) -> None:
    """Put line items on the transaction itself, for flows that keep one row."""
    items = tx.get("items") or []
    if not items:
        return
    listing = "; ".join(
        f"{i['qty']:g} × {i['name']}" + (f" ({i['unit']})" if i.get("unit") else "")
        for i in items
    )
    if len(items) == 1:
        tx["item_name"] = items[0]["name"]
        qty_label = item_quantity(items[0]["qty"], items[0].get("unit"))
        if qty_label:
            tx["quantity"] = qty_label
    else:
        tx["item_name"] = f"{items[0]['name']} +{len(items) - 1} more"

    existing = (tx.get("notes") or "").strip()
    tx["notes"] = f"{listing} · {existing}" if existing else listing


# ── Prompt assembly ──────────────────────────────────────────────────────────
def build_prompt(units: list[dict], region: str, today_date: str) -> str:
    parts: list[str] = []
    if region:
        parts.append(f"User is in {region}.")
    parts.append(f"Today's date is {today_date}.")

    for unit in units:
        if unit["kind"] == "email":
            parts.append(f"From: {unit.get('from', '')}")
            parts.append(f"Subject: {unit.get('subject', '')}")
            parts.append("--- EMAIL BODY ---")
            parts.append(unit.get("text", "")[:MAX_EMAIL_CHARS])
        elif unit["kind"] == "document":
            label = unit.get("source") or "attachment"
            note = " (truncated)" if unit.get("truncated") else ""
            parts.append(f"--- ATTACHED DOCUMENT: {label}{note} ---")
            parts.append(unit.get("text", "")[:MAX_DOC_CHARS])
        elif unit["kind"] == "text":
            parts.append("--- TEXT ---")
            parts.append(unit.get("text", "")[:MAX_DOC_CHARS])

    return "\n".join(parts)[:MAX_TOTAL_CHARS]


def text_unit(text: str) -> dict:
    """Entry helper for raw text (SMS, pasted input, shortcut)."""
    return {"kind": "text", "text": text, "group": 0}


def image_unit(image_base64: str, mime_type: str, source: str = "") -> dict:
    return {"kind": "images", "pages": [image_base64], "mime": mime_type,
            "source": source, "group": 0}


def _skip_reason_for_body_only(units: list[dict]) -> str | None:
    """The cheap guards, worth keeping: they reject a login alert or a covering
    note for free, where an AI call costs ~12s and real money."""
    content = [u for u in units if u["kind"] in ("email", "document", "text")]
    images = [u for u in units if u["kind"] == "images"]
    if images or len(content) != 1 or content[0]["kind"] == "document":
        return None
    text = content[0].get("text") or ""
    if len(text) < MIN_BODY_CHARS:
        return "too_short"
    if not _TRANSACTION_SIGNALS.search(text):
        return "no_signal"
    return None


# ── The parser ───────────────────────────────────────────────────────────────
async def parse_units(
    units: list[dict],
    region: str,
    today_date: str,
    min_confidence: float = CONFIDENCE_FLOOR,
    apply_cheap_guards: bool = True,
) -> dict:
    """Returns {"transactions": [...], "docType": str, "skipReason": str|None}."""
    t0 = time.time()
    text_units = [u for u in units
                  if u["kind"] in ("email", "document", "text")
                  and (u.get("text") or u.get("subject"))]
    image_units = [u for u in units if u["kind"] == "images" and u.get("pages")]

    if not text_units and not image_units:
        return {"transactions": [], "docType": "purchase", "skipReason": "nothing_to_parse"}

    if apply_cheap_guards:
        reason = _skip_reason_for_body_only(text_units + image_units)
        if reason:
            log.info("parse", "skipped before AI", {"reason": reason})
            return {"transactions": [], "docType": "purchase", "skipReason": reason}

    prompt = build_prompt(text_units, region, today_date)
    pages = [(p, u.get("mime") or "image/png") for u in image_units for p in u["pages"]]

    log.info("parse", "parsing", {
        "textUnits": len(text_units), "imagePages": len(pages),
        "promptChars": len(prompt), "minConfidence": min_confidence,
    })

    raw_rows: list[dict] = []
    doc_type = "purchase"
    try:
        if pages:
            # The image chain takes one image, so scanned pages go one per call.
            for i, (page, mime) in enumerate(pages, 1):
                context = prompt + (f"\n\nThis is page {i} of {len(pages)}."
                                    if len(pages) > 1 else "")
                raw = await generate_with_image(page, mime, context, SYSTEM_PROMPT, 4096)
                parsed = try_parse_ai_json(raw)
                if isinstance(parsed, dict):
                    if parsed.get("doc_type") == "statement":
                        doc_type = "statement"
                    raw_rows.extend(r for r in (parsed.get("transactions") or [])
                                    if isinstance(r, dict))
        else:
            raw = await generate_text(prompt, SYSTEM_PROMPT, 4096)
            parsed = try_parse_ai_json(raw)
            if not isinstance(parsed, dict):
                log.warn("parse", "AI response was not a JSON object",
                         {"rawChars": len(raw), "rawHead": raw[:160].replace("\n", " ")})
                return {"transactions": [], "docType": "purchase", "skipReason": "ai_null"}
            if parsed.get("doc_type") == "statement":
                doc_type = "statement"
            raw_rows = [r for r in (parsed.get("transactions") or []) if isinstance(r, dict)]
    except Exception as err:
        log.error("parse", "ai call failed", err, {"promptChars": len(prompt)})
        return {"transactions": [], "docType": "purchase", "skipReason": "parse_error"}

    ai_ms = int((time.time() - t0) * 1000)
    if not raw_rows:
        log.info("parse", "AI reported no debit to record", {"docType": doc_type, "ms": ai_ms})
        return {"transactions": [], "docType": doc_type, "skipReason": "ai_null"}

    valid, dropped = [], []
    for r in raw_rows:
        tx = validate_transaction(r, today_date, min_confidence)
        if tx:
            valid.append(tx)
        else:
            dropped.append(f"{r.get('merchant', '?')}/{r.get('amount', '?')}")
    if dropped:
        log.warn("parse", "rows failed validation",
                 {"dropped": len(dropped), "kept": len(valid), "rejected": "; ".join(dropped[:8])})
    if not valid:
        return {"transactions": [], "docType": doc_type, "skipReason": "validation_failed"}

    # A purchase is one payment; more than one row means the component invoices
    # were multiplied after all. The customer-facing total exceeds any component,
    # so the largest is the real charge.
    if doc_type == "purchase" and len(valid) > 1:
        log.warn("parse", "purchase returned multiple rows — collapsing to the largest",
                 {"rows": len(valid), "amounts": ",".join(str(t["amount"]) for t in valid)})
        valid = [max(valid, key=lambda t: t["amount"])]

    log.info("parse", "done", {
        "docType": doc_type, "rows": len(valid),
        "amounts": ",".join(str(t["amount"]) for t in valid[:12]),
        "merchants": " | ".join(t["merchant"] for t in valid[:6]),
        "ms": int((time.time() - t0) * 1000),
    })
    return {"transactions": valid, "docType": doc_type, "skipReason": None}

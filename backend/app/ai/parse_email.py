"""Email transaction parser — port of src/lib/ai/parse-email.ts."""
import re
from datetime import date

from app.ai.client import generate_text
from app.ai.parse_json import try_parse_ai_json
from app.sheets.transaction_schema import _parse_float

EMAIL_SYSTEM_PROMPT = """You are a financial transaction extractor for Indian payment-related emails.

Extract ONLY debit transactions — money leaving the user's account (purchases, bills, transfers out).
Ignore: credit transactions, refunds, incoming transfers, balance alerts, reward points, promotional emails.

Field rules:
- amount: actual amount PAID/DEBITED in INR (positive number). Never use "available balance", "MRP", "you saved", reward points.
- merchant: the payee/store name. Clean up noise: "UPI/SWIGGY/123456" → "Swiggy", "POS/AMAZON.IN" → "Amazon", VPA "zomato@upi" → "Zomato". For person-to-person transfers (NEFT/IMPS/RTGS), use the recipient name.
- category: one of — Food & Dining, Transport, Shopping, Entertainment, Health, Bills & Utilities, Education, Personal Care, Gifts & Donations, Others.
- payment_method: UPI | Card | NetBanking | Cash | Other.
- date: YYYY-MM-DD. Transaction date, not the email received date.
- time: HH:MM 24h. Use "00:00" if absent.
- item_name: specific product/service purchased. Examples: "Airtel Mobile Recharge", "Zomato Order #123", "Electricity Bill May 2026", "Netflix Monthly", "Amazon Purchase". Omit (null) for generic transfers where no specific item is identifiable.
- notes: transaction/reference ID or any other useful detail not captured elsewhere. Examples: "Ref: 123456789", "UPI Ref: TXN9876", "Order #AMZ-123". Omit (null) if nothing useful.
- confidence: 0–1. Set below 0.65 if amount, merchant, or date is ambiguous.
- uncertain_fields: array of field names you are unsure about, e.g. ["date", "merchant"].

Return null (not JSON) if:
- Credit / incoming transaction
- No clear debit amount
- Merchant cannot be determined
- Promotional, newsletter, or non-transaction email
- Confidence would be below 0.65

Respond with valid JSON only — no markdown fences, no explanation:
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
}"""

# ── HTML / text extraction ────────────────────────────────────────────────────

_STYLE_RE = re.compile(r"<style[^>]*>[\s\S]*?</style>", re.IGNORECASE)
_SCRIPT_RE = re.compile(r"<script[^>]*>[\s\S]*?</script>", re.IGNORECASE)
_COMMENT_RE = re.compile(r"<!--[\s\S]*?-->")
_BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_BLOCK_RE = re.compile(r"</?(div|p|tr|li|h[1-6]|section|article)[^>]*>", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def extract_email_text(raw_body: str, mime_type: str) -> str:
    """Extract readable plain text from email body (HTML or plain text)."""
    text = raw_body

    if "html" in mime_type:
        text = _STYLE_RE.sub(" ", text)
        text = _SCRIPT_RE.sub(" ", text)
        text = _COMMENT_RE.sub(" ", text)
        text = _BR_RE.sub("\n", text)
        text = _BLOCK_RE.sub("\n", text)
        text = _TAG_RE.sub(" ", text)
        text = (
            text.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&nbsp;", " ")
            .replace("&#8377;", "₹")
            .replace("&apos;", "'")
            .replace("&quot;", '"')
        )

    return _WS_RE.sub(" ", text).strip()


# ── Transaction signal check ──────────────────────────────────────────────────

_TRANSACTION_SIGNALS = re.compile(
    r"debited|credited|paid|transaction|charged|₹|inr|rs\.|rupee|amount|payment",
    re.IGNORECASE,
)


def _has_transaction_signal(text: str) -> bool:
    return bool(_TRANSACTION_SIGNALS.search(text))


# ── Validation gauntlet ───────────────────────────────────────────────────────

VALID_PAYMENT_METHODS = ["Cash", "UPI", "Card", "NetBanking", "Other"]
VALID_CATEGORIES = [
    "Food & Dining", "Transport", "Shopping", "Entertainment", "Health",
    "Bills & Utilities", "Education", "Personal Care", "Gifts & Donations", "Others",
]

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^\d{2}:\d{2}$")


def validate_transaction(raw: dict, today_date: str) -> dict | None:
    raw_amount = raw.get("amount")
    amount = raw_amount if isinstance(raw_amount, (int, float)) and not isinstance(raw_amount, bool) \
        else _parse_float(raw_amount if raw_amount is not None else "0")
    if not (amount == amount) or amount <= 0 or amount > 500_000:  # NaN guard via self-compare
        return None

    raw_conf = raw.get("confidence")
    confidence = raw_conf if isinstance(raw_conf, (int, float)) and not isinstance(raw_conf, bool) else 0
    if confidence < 0.65:
        return None

    raw_merchant = raw.get("merchant")
    merchant = raw_merchant.strip() if isinstance(raw_merchant, str) else ""
    if not merchant or merchant.lower() == "unknown":
        return None

    date_str = raw.get("date") if isinstance(raw.get("date"), str) else ""
    if not _DATE_RE.match(date_str):
        return None
    tx_date = date.fromisoformat(date_str)
    today = date.fromisoformat(today_date)
    try:
        two_years_ago = today.replace(year=today.year - 2)
    except ValueError:  # Feb 29 → roll to Mar 1, matching JS setFullYear
        two_years_ago = today.replace(year=today.year - 2, month=3, day=1)
    # Allow up to 1 day in the "future" to cover users in timezones ahead of
    # the server UTC clock (IST is UTC+5:30).
    from datetime import timedelta
    tomorrow = today + timedelta(days=1)
    if tx_date > tomorrow or tx_date < two_years_ago:
        return None

    raw_pm = raw.get("payment_method") if isinstance(raw.get("payment_method"), str) else "Other"
    payment_method = raw_pm if raw_pm in VALID_PAYMENT_METHODS else "Other"

    raw_cat = raw.get("category") if isinstance(raw.get("category"), str) else "Others"
    category = raw_cat if raw_cat in VALID_CATEGORIES else "Others"

    raw_time = raw.get("time")
    time = raw_time if isinstance(raw_time, str) and _TIME_RE.match(raw_time) else "00:00"

    raw_item = raw.get("item_name")
    raw_notes = raw.get("notes")
    raw_uncertain = raw.get("uncertain_fields")

    tx: dict = {
        "merchant": merchant,
        "amount": amount,
        "date": date_str,
        "time": time,
        "category": category,
        "payment_method": payment_method,
        "confidence": confidence,
        "uncertain_fields": [str(f) for f in raw_uncertain] if isinstance(raw_uncertain, list) else [],
        "currency": "INR",
    }
    item_name = raw_item.strip() if isinstance(raw_item, str) else ""
    if item_name:
        tx["item_name"] = item_name
    notes = raw_notes.strip() if isinstance(raw_notes, str) else ""
    if notes:
        tx["notes"] = notes
    return tx


# ── Public API ────────────────────────────────────────────────────────────────

_NULL_RE = re.compile(r"^\s*null\s*$", re.IGNORECASE)


async def parse_email_transaction(
    email_text: str,
    from_addr: str,
    subject: str,
    region: str,
    today_date: str,
) -> dict:
    # 1. Length guard
    if len(email_text) < 80:
        return {"transaction": None, "skipReason": "too_short"}

    # 2. Signal check (fast, no AI)
    if not _has_transaction_signal(email_text):
        return {"transaction": None, "skipReason": "no_signal"}

    # 3. Build user prompt
    user_prompt = "\n".join(
        p for p in [
            f"User is in {region}." if region else "",
            f"Today's date is {today_date}.",
            f"From: {from_addr}",
            f"Subject: {subject}",
            "---",
            email_text[:4000],
        ] if p
    )

    # 4. AI call
    try:
        raw = await generate_text(user_prompt, EMAIL_SYSTEM_PROMPT, 512)
    except Exception:
        return {"transaction": None, "skipReason": "parse_error"}

    # 5. Parse JSON — AI returns null for non-transaction emails
    if _NULL_RE.match(raw.strip()):
        return {"transaction": None, "skipReason": "ai_null"}
    parsed = try_parse_ai_json(raw)
    if not parsed:
        return {"transaction": None, "skipReason": "ai_null"}

    # 6. Validation gauntlet
    tx = validate_transaction(parsed, today_date)
    if not tx:
        return {"transaction": None, "skipReason": "validation_failed"}

    return {"transaction": tx}

"""AI layer — ports of src/lib/ai/*."""
from app.ai.client import generate_text, generate_with_image, active_provider
from app.ai.parse_json import try_parse_ai_json, parse_ai_json
from app.ai.parse_text import SYSTEM_PROMPT, parse_transaction_text
from app.ai.parse_image import parse_receipt_image
from app.ai.parse_email import (
    EMAIL_SYSTEM_PROMPT,
    extract_email_text,
    parse_email_transaction,
)
from app.ai.parse_notes import extract_from_notes
from app.ai.analyze import analyze_spending
from app.ai.compare import compare_merchants
from app.ai.dedup import find_duplicates
from app.ai.normalize_items import normalize_item_names
from app.ai.merge_transactions import merge_transactions

__all__ = [
    "generate_text",
    "generate_with_image",
    "active_provider",
    "try_parse_ai_json",
    "parse_ai_json",
    "SYSTEM_PROMPT",
    "parse_transaction_text",
    "parse_receipt_image",
    "EMAIL_SYSTEM_PROMPT",
    "extract_email_text",
    "parse_email_transaction",
    "extract_from_notes",
    "analyze_spending",
    "compare_merchants",
    "find_duplicates",
    "normalize_item_names",
    "merge_transactions",
]

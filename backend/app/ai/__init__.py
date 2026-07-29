"""AI layer. One prompt and one validator live in parse_units; everything
else here is an entry adapter or a task-specific helper."""
from app.ai.client import generate_text, generate_with_image, active_provider
from app.ai.parse_json import try_parse_ai_json, parse_ai_json
from app.ai.parser import (
    SYSTEM_PROMPT,
    fold_items,
    image_unit,
    parse_units,
    text_unit,
    validate_transaction,
)
from app.ai.parse_text import parse_transaction_text
from app.ai.parse_image import parse_receipt_image
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
    "parse_units",
    "validate_transaction",
    "fold_items",
    "text_unit",
    "image_unit",
    "parse_transaction_text",
    "parse_receipt_image",
    "extract_from_notes",
    "analyze_spending",
    "compare_merchants",
    "find_duplicates",
    "normalize_item_names",
    "merge_transactions",
]

"""Sheet tab headers.

Header names and order are LOAD-BEARING — they must stay in step with
transaction_schema.COLS, and the write range must cover all of them."""

EXPECTED_HEADERS = (
    "id", "date", "time", "amount", "original_amount", "original_currency",
    "merchant", "category", "subcategory", "item_name", "payment_method",
    "tags", "notes", "source", "raw_input", "location",
    "is_duplicate", "duplicate_ref", "created_at", "updated_at",
    "status", "receipt_url", "receipt_id", "quantity", "deleted", "recurrence",
    "merge_id",
)

CATEGORIES_HEADERS       = ("id", "name", "parent_id", "color", "icon", "is_default", "created_at")
ANALYSIS_CACHE_HEADERS   = ("id", "period", "period_type", "summary_json", "generated_at", "status", "drive_file_id")
ITEM_SUGGESTIONS_HEADERS = ("key", "field", "current_val", "suggested", "source", "status", "updated_at")
META_HEADERS             = ("key", "value")
PARSED_EMAILS_HEADERS    = ("email_id", "from", "subject", "parsed_at", "status", "tx_ids", "attempts")

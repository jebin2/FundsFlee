export const EXPECTED_HEADERS = [
  "id", "date", "time", "amount", "original_amount", "original_currency",
  "merchant", "category", "subcategory", "item_name", "payment_method",
  "tags", "notes", "source", "raw_input", "location",
  "is_duplicate", "duplicate_ref", "created_at", "updated_at",
  "status", "receipt_url", "receipt_id", "quantity", "deleted", "recurrence",
] as const;

export const CATEGORIES_HEADERS        = ["id", "name", "parent_id", "color", "icon", "is_default", "created_at"] as const;
export const ANALYSIS_CACHE_HEADERS    = ["id", "period", "period_type", "summary_json", "generated_at", "status", "drive_file_id"] as const;
export const ITEM_SUGGESTIONS_HEADERS  = ["key", "field", "current_val", "suggested", "source", "status", "updated_at"] as const;
export const META_HEADERS              = ["key", "value"] as const;
export const PARSED_EMAILS_HEADERS     = ["email_id", "from", "subject", "parsed_at", "status", "tx_ids"] as const;

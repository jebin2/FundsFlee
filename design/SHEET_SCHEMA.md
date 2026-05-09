# SpendingTracker — Google Sheet Schema

The app uses a single Google Spreadsheet (identified via Drive `appProperties`, not by name) with five tabs.

---

## Tab: `transactions`

25 columns, A–Y. One row per transaction or receipt line item.

| Col | Field | Type | Notes |
|-----|-------|------|-------|
| A | `id` | UUID | Primary key |
| B | `date` | `YYYY-MM-DD` | |
| C | `time` | `HH:MM` | |
| D | `amount` | number | In INR |
| E | `original_amount` | number | If foreign currency |
| F | `original_currency` | string | e.g. `USD` |
| G | `merchant` | string | `"Unknown"` if not set |
| H | `category` | string | e.g. `Food & Dining` |
| I | `subcategory` | string | Optional |
| J | `item_name` | string | Specific product name; primary display label |
| K | `payment_method` | string | `UPI` / `Card` / `Cash` / `NetBanking` / `Other` |
| L | `tags` | string | Comma-separated |
| M | `notes` | string | Free-text user notes |
| N | `source` | string | `manual` / `sms` / `receipt` / `email` / `shortcut` |
| O | `raw_input` | string | Original SMS/email text |
| P | `location` | string | Optional |
| Q | `is_duplicate` | `TRUE`/`FALSE` | |
| R | `duplicate_ref` | UUID | ID of the original transaction |
| S | `created_at` | ISO 8601 | |
| T | `updated_at` | ISO 8601 | |
| U | `status` | string | `queued` / `processing` / `done` / `failed` |
| V | `receipt_url` | string | Google Drive link to scanned image |
| W | `receipt_id` | UUID | Groups all line items from the same scanned receipt |
| X | `quantity` | string | e.g. `500g`, `1kg`, `2 pcs` |
| Y | `deleted` | `TRUE`/`""` | Soft delete — row stays in sheet, filtered on read |

**Notes:**
- Deleted rows: column Y = `TRUE`. Never physically removed.
- Receipt scan: one placeholder row created (status `queued`), replaced by N per-item rows sharing the same `receipt_id`. Placeholder is soft-deleted (Y = `TRUE`) after processing.
- Schema migration: `ensureTransactionSchema()` is called on login and on every `appendTransaction` — if the header row has fewer than 25 columns it rewrites `A1:Y1` with the full header. Safe to add new columns at the end.

---

## Tab: `item_suggestions`

7 columns, A–G. AI-generated field correction suggestions shown as chips in the transaction list.

| Col | Field | Type | Notes |
|-----|-------|------|-------|
| A | `key` | string | Always `tx:{transaction_id}` — for `normalize` source, the first tx found with that item name; for `notes` source, the exact tx |
| B | `field` | string | Which field: `item_name` / `quantity` / `merchant` |
| C | `current_val` | string | Current value of the field in the transaction |
| D | `suggested` | string | AI-proposed replacement |
| E | `source` | string | See below |
| F | `status` | string | See below |
| G | `updated_at` | ISO 8601 | Last status change |

### `source` values

| Value | Meaning | On accept |
|-------|---------|-----------|
| `normalize` | AI grouped item name variants (e.g. `Milk` → `Amul UHT Milk`). One row per unique item name. | Updates **all** transactions whose `item_name` matches `current_val` |
| `notes` | AI extracted a field from the transaction's free-text notes. One row per transaction. | Updates **only** that transaction |

### `status` values

| Value | Meaning |
|-------|---------|
| `pending` | Waiting for user action — chip shown in the UI |
| `processing` | AI is currently generating the suggestion |
| `accepted` | User accepted — field updated in transactions tab |
| `rejected` | User dismissed — chip removed, no changes |

### Sentinel rows
When AI finds no suggestion for an item/transaction, a sentinel row is still written (`current_val == suggested`) so the normalisation job skips it on future runs. Sentinels have `status = pending` but are filtered out of the UI (chip not shown).

### Dedup rules
- By `key::field` — never insert a second row for the same key+field combo.
- For `normalize` rows, also dedup by `current_val::field` — protects against a different representative tx ID being chosen on re-runs.

---

## Tab: `categories`

7 columns: `id | name | parent_id | color | icon | is_default | created_at`

Hierarchical. Parent rows have empty `parent_id`. Seeded with defaults on sheet creation.

---

## Tab: `analysis_cache`

7 columns: `id | period | period_type | summary_json | generated_at | status | drive_file_id`

Caches AI-generated spend analysis per period. Large results (> 40 KB) are stored in Google Drive and referenced via `drive_file_id`.

| `status` | Meaning |
|----------|---------|
| `generating` | Background AI job in progress |
| `done` | Result ready |
| `failed` | Generation error |

---

## Tab: `meta`

2 columns: `key | value`

Key-value store for app-level state.

| Key | Value |
|-----|-------|
| `sheet_url` | Public URL of this spreadsheet |
| `items_normalized_at` | ISO timestamp of last normalization run (throttled to 1 hr) |

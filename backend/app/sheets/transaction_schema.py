"""Transactions-sheet column layout — port of src/lib/sheets/transactionSchema.ts.

Single source of truth for the transactions sheet column layout.
When adding a column: add it here and nowhere else.

Transactions are plain dicts shaped exactly like the TS `Transaction`
interface — optional fields are OMITTED (not None) so JSON responses stay
byte-identical to the Next.js app.
"""
import re
from datetime import date, timedelta
from typing import Any

from app.core.dates import now_iso

COLS: dict[str, tuple[int, str]] = {
    # field: (index, letter)
    "id":                (0,  "A"),
    "date":              (1,  "B"),
    "time":              (2,  "C"),
    "amount":            (3,  "D"),
    "original_amount":   (4,  "E"),
    "original_currency": (5,  "F"),
    "merchant":          (6,  "G"),
    "category":          (7,  "H"),
    "subcategory":       (8,  "I"),
    "item_name":         (9,  "J"),
    "payment_method":    (10, "K"),
    "tags":              (11, "L"),
    "notes":             (12, "M"),
    "source":            (13, "N"),
    "raw_input":         (14, "O"),
    "location":          (15, "P"),
    "is_duplicate":      (16, "Q"),
    "duplicate_ref":     (17, "R"),
    "created_at":        (18, "S"),
    "updated_at":        (19, "T"),
    "status":            (20, "U"),
    "receipt_url":       (21, "V"),
    "receipt_id":        (22, "W"),
    "quantity":          (23, "X"),
    "deleted":           (24, "Y"),
    "recurrence":        (25, "Z"),
    "merge_id":          (26, "AA"),
    # Why a row is in "failed". Written beside the status, never instead of it:
    # the status drives the UI, this explains it to the person reading the row.
    "failure_reason":    (27, "AB"),
}

NUM_COLS = len(COLS)
LAST_COL = COLS["failure_reason"][1]


def idx(field: str) -> int:
    return COLS[field][0]


def _opt(tx: dict, key: str) -> Any:
    """JS `tx.key ?? ""` — empty string only for null/missing (0 stays 0)."""
    v = tx.get(key)
    return "" if v is None else v


_FLOAT_PREFIX = re.compile(r"^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")


def _parse_float(s: Any) -> float:
    """JS `parseFloat(...) || 0` semantics — parses the longest numeric
    prefix (parseFloat("1,234") → 1), NaN/invalid → 0."""
    if isinstance(s, (int, float)) and not isinstance(s, bool):
        return float(s) if s == s else 0
    m = _FLOAT_PREFIX.match(str(s).lstrip() if s is not None else "")
    return float(m.group(0)) if m else 0


def _num(v: float) -> Any:
    """Collapse integral floats to int so JSON matches JS (450, not 450.0)."""
    return int(v) if isinstance(v, float) and v.is_integer() else v


_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Sheets counts days from 1899-12-30.
_SHEETS_EPOCH = date(1899, 12, 30)


def _iso_date(v: Any) -> Any:
    """Normalise the date cell back to YYYY-MM-DD.

    The column is stored as a real date and formatted yyyy-mm-dd, so the read
    already matches and passes straight through. A bare serial number means the
    format did not stick — convert rather than hand the app a number it would
    silently compare as a string. Anything else is returned untouched: guessing
    between 07/08 and 08/07 could corrupt a date, and leaving it alone fails
    visibly instead.
    """
    if isinstance(v, str) and _ISO_DATE_RE.match(v):
        return v
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return (_SHEETS_EPOCH + timedelta(days=int(v))).isoformat()
    return v


def transaction_to_row(tx: dict) -> list:
    return [
        tx["id"], tx["date"], tx["time"], tx["amount"],
        _opt(tx, "original_amount"), _opt(tx, "original_currency"),
        tx["merchant"], tx["category"], _opt(tx, "subcategory"),
        _opt(tx, "item_name"), tx["payment_method"],
        ",".join(tx.get("tags") or []), _opt(tx, "notes"),
        tx["source"], _opt(tx, "raw_input"), _opt(tx, "location"),
        "TRUE" if tx.get("is_duplicate") else "FALSE", _opt(tx, "duplicate_ref"),
        tx["created_at"], tx["updated_at"],
        tx.get("status") if tx.get("status") is not None else "done",
        _opt(tx, "receipt_url"), _opt(tx, "receipt_id"), _opt(tx, "quantity"),
        "TRUE" if tx.get("deleted") else "",
        _opt(tx, "recurrence"),
        _opt(tx, "merge_id"),
        _opt(tx, "failure_reason"),
    ]


def _js_truthy(v: Any) -> bool:
    """JS truthiness: '', 0, NaN, null/undefined, false are falsy."""
    if v is None or v is False:
        return False
    if isinstance(v, str):
        return v != ""
    if isinstance(v, (int, float)):
        return v != 0 and v == v  # 0 and NaN falsy
    return True


def row_to_transaction(r: list) -> dict:
    # Pad short rows so index access never throws on malformed sheet data
    row = list(r) + [""] * (NUM_COLS - len(r)) if len(r) < NUM_COLS else r

    def raw(field: str) -> Any:
        return row[idx(field)]

    def nullish(field: str) -> Any:
        """JS `row[i] ?? ""` — empty string only for null/undefined."""
        v = raw(field)
        return "" if v is None else v

    def either(field: str, default: Any) -> Any:
        """JS `row[i] || default` — raw-value truthiness, like JS."""
        v = raw(field)
        return v if _js_truthy(v) else default

    tx: dict = {
        "id":             raw("id"),
        "date":           _iso_date(nullish("date")),
        "time":           nullish("time"),
        "amount":         _num(_parse_float(raw("amount"))),
        "merchant":       nullish("merchant"),
        "category":       nullish("category"),
        "payment_method": either("payment_method", "Other"),
        "source":         either("source", "manual"),
        "is_duplicate":   raw("is_duplicate") == "TRUE",
        "created_at":     nullish("created_at"),
        "updated_at":     nullish("updated_at"),
        "status":         either("status", "done"),
    }
    # Optional fields — key present only when truthy, mirroring `|| undefined`
    # (TS leaves them undefined → omitted from JSON)
    if _js_truthy(raw("original_amount")):
        tx["original_amount"] = _num(_parse_float(raw("original_amount")))
    for field in (
        "original_currency", "subcategory", "item_name", "notes", "raw_input",
        "location", "duplicate_ref", "receipt_url", "receipt_id", "quantity",
        "recurrence", "merge_id", "failure_reason",
    ):
        if _js_truthy(raw(field)):
            tx[field] = raw(field)
    if _js_truthy(raw("tags")):
        tx["tags"] = [t for t in str(raw("tags")).split(",") if t]
    return tx


def is_deleted_row(r: list) -> bool:
    def at(i: int) -> str:
        return str(r[i]) if i < len(r) and r[i] is not None else ""
    return at(idx("deleted")) == "TRUE" or at(idx("notes")) == "__DELETED__"


def transaction_update_to_fields(updates: dict, now: str | None = None) -> dict:
    """Normalise a partial update into {column: cell value}.

    id and created_at are immutable; updated_at is always written.

    Moving off "failed" clears the reason. Enforced here rather than at each
    caller because there are a dozen of them — a retry, a re-parse, a manual
    edit — and a reason that outlives the failure it describes is worse than no
    reason at all: the row reads as fixed and still explains why it broke.
    """
    if now is None:
        now = now_iso()

    updates = dict(updates)
    if (updates.get("status") not in (None, "failed")
            and "failure_reason" not in updates):
        updates["failure_reason"] = ""

    fields: dict = {}
    for key in COLS:
        if key in ("id", "created_at"):
            continue
        if key in updates or key == "updated_at":
            val: Any = now if key == "updated_at" else updates.get(key)
            if key == "is_duplicate":
                val = "TRUE" if val else "FALSE"
            if key == "deleted":
                val = "TRUE" if val else ""
            if key == "tags" and isinstance(val, list):
                val = ",".join(val)
            fields[key] = val if val is not None else ""
    return fields

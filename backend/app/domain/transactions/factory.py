"""Placeholder transaction factories — port of src/domain/transactions/factory.ts."""
import uuid

from app.core.dates import today_iso, now_iso
from app.domain.transactions.metadata import encode_merge_metadata


def _base_placeholder(id: str | None = None) -> dict:
    now = now_iso()
    return {
        "id": id or str(uuid.uuid4()),
        "date": today_iso(),
        "time": now.split("T")[1][:5],
        "amount": 0,
        "category": "Others",
        "payment_method": "Other",
        "created_at": now,
        "updated_at": now,
    }


def create_queued_text_parse_transaction(text: str) -> dict:
    return {
        **_base_placeholder(),
        "merchant": "Parsing SMS…",
        "source": "sms",
        "status": "queued",
        "raw_input": text[:1000],
    }


def create_queued_receipt_transaction(receipt_url: str, id: str | None = None) -> dict:
    return {
        **_base_placeholder(id),
        "merchant": "Processing…",
        "source": "receipt",
        "status": "queued",
        "receipt_url": receipt_url,
    }


def create_queued_pdf_transaction(receipt_url: str, filename: str = "") -> dict:
    return {
        **_base_placeholder(),
        # The file's own name, because this path takes any PDF — an order
        # summary, an invoice, a statement. "Bank Statement" was left over from
        # when it only did one of those, and mislabelled every other upload.
        # It also names which file is in flight when two are queued at once.
        "merchant": filename[:80] or "Processing PDF…",
        "source": "import",
        "status": "queued",
        "receipt_url": receipt_url,
        # The rows extracted from this file inherit it, so each one records
        # which upload it came from.
        "raw_input": filename[:500],
    }


def create_merge_placeholder_transaction(source_ids: list[str]) -> dict:
    return {
        **_base_placeholder(),
        "merchant": "Merging…",
        "source": "merge",
        "status": "merging",
        "notes": encode_merge_metadata(source_ids),
    }

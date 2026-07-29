"""Bank statement parse job.

The PDF becomes units (text layer, or rasterised pages when scanned) and goes
through the single parser, so statement rows now pass the same validation as
every other row.
"""
import re
import uuid

from app.ai.parser import NO_FLOOR, fold_items, parse_units
from app.core.dates import today_iso, now_iso
from app.services.expand_items import build_item_rows, priced_items
from app.extract.pipeline import collect_units
from app.core.deps import SheetSession
from app.core.logger import log
from app.sheets import (
    append_transactions,
    download_receipt_from_drive,
    get_transaction_by_id,
    update_transaction_field,
)

_DRIVE_ID_RE = re.compile(r"/d/([a-zA-Z0-9_-]+)")


def _receipt_file_id(url: str) -> str | None:
    m = _DRIVE_ID_RE.search(url)
    return m.group(1) if m else None


async def run_statement_parse_job(session: SheetSession, placeholder_id: str) -> None:
    log.info("statement-parse", "started", {"placeholderId": placeholder_id})

    try:
        await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {"status": "processing"})
        placeholder = await get_transaction_by_id(session.access_token, session.sheet_id, placeholder_id)
        if not placeholder or not placeholder.get("receipt_url"):
            await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {"status": "failed"})
            log.error("statement-parse", "no receipt_url on placeholder", None, {"placeholderId": placeholder_id})
            return

        file_id = _receipt_file_id(placeholder["receipt_url"])
        if not file_id:
            await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {"status": "failed"})
            return

        downloaded = await download_receipt_from_drive(session.access_token, file_id)
        units = await collect_units(downloaded["buffer"], "application/pdf", "statement.pdf")
        parsed = await parse_units(units, "", today_iso(),
                                   min_confidence=NO_FLOOR, apply_cheap_guards=False)
        rows = parsed["transactions"]

        log.info("statement-parse", f"extracted {len(rows)} transactions", {"placeholderId": placeholder_id})

        now = now_iso()
        rows_to_write = []
        for row in rows:
            base = {
                "date": row.get("date"),
                "time": row.get("time") or "00:00",
                "merchant": row.get("merchant"),
                "category": row.get("category"),
                "subcategory": row.get("subcategory"),
                "original_amount": row.get("original_amount"),
                "original_currency": row.get("original_currency"),
                "payment_method": row.get("payment_method") or "Other",
                "tags": row.get("tags"),
                "notes": row.get("notes"),
                "source": "import",
                "raw_input": placeholder.get("raw_input"),
                "receipt_id": placeholder_id,
            }

            # Same rule as a photographed receipt: an itemised bill with real
            # per-item prices becomes a row each; anything else stays one row
            # with the item names folded into notes, because splitting a total
            # across unpriced lines would be inventing the numbers.
            items = priced_items(row.get("items"))
            if len(items) > 1:
                log.info("statement-parse", "expanding to item rows",
                         {"placeholderId": placeholder_id, "items": len(items)})
                rows_to_write.extend(build_item_rows(base, items, now, row.get("amount")))
            else:
                fold_items(row)
                rows_to_write.append({
                    **base,
                    "id": str(uuid.uuid4()),
                    "amount": row.get("amount"),
                    "item_name": row.get("item_name"),
                    "quantity": row.get("quantity"),
                    "notes": row.get("notes"),
                    "status": "done",
                    "created_at": now,
                    "updated_at": now,
                })

        # One request for the whole statement, not one per debit line.
        await append_transactions(session.access_token, session.sheet_id, rows_to_write)

        # Mark placeholder done (don't delete — keeps it as an audit entry)
        await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {
            "deleted": True,
            "status": "done",
        })

        log.info("statement-parse", "done", {"placeholderId": placeholder_id, "count": len(rows)})
    except Exception as err:
        log.error("statement-parse", "failed", err, {"placeholderId": placeholder_id})
        try:
            await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {"status": "failed"})
        except Exception:
            pass
        raise

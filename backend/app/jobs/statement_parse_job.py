"""Bank statement parse job.

The PDF becomes units (text layer, or rasterised pages when scanned) and goes
through the single parser, so statement rows now pass the same validation as
every other row.
"""
import re
import uuid

from app.ai.parser import NO_FLOOR, parse_units
from app.core.dates import today_iso, now_iso
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
            tx = {
                "id": str(uuid.uuid4()),
                "date": row.get("date"),
                "time": "00:00",
                "amount": row.get("amount"),
                "merchant": row.get("merchant"),
                "category": row.get("category"),
                "payment_method": row.get("payment_method") or "Other",
                "notes": row.get("notes"),
                "source": "import",
                "receipt_id": placeholder_id,
                "status": "done",
                "created_at": now,
                "updated_at": now,
            }
            rows_to_write.append(tx)
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

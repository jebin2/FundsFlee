"""Text parse job — port of src/server/jobs/textParseJob.ts."""
from app.ai.parse_text import parse_transaction_text
from app.core.dates import today_iso, now_iso
from app.core.deps import SheetSession
from app.core.logger import log
from app.services.duplicate_scan import deduplicate_new_transactions
from app.services.expand_items import finish_placeholder, rows_from_parsed
from app.sheets import get_transaction_by_id, update_transaction_field
from app.domain.transactions.failure import mark_failed


async def run_text_parse_job(session: SheetSession, tx_id: str, region: str = "") -> None:
    log.info("text-parse", "started", {"txId": tx_id})

    try:
        await update_transaction_field(session.access_token, session.sheet_id, tx_id, {"status": "processing"})
        placeholder = await get_transaction_by_id(session.access_token, session.sheet_id, tx_id)
        if not placeholder or not placeholder.get("raw_input"):
            await mark_failed(session.access_token, session.sheet_id, tx_id,
                              "There is no text on this transaction to parse.")
            log.error("text-parse", "no raw_input on placeholder", None, {"txId": tx_id})
            return

        result = await parse_transaction_text(placeholder["raw_input"], region, today_iso())
        now = now_iso()

        # Pasted text can hold a whole statement, so every transaction counts.
        rows = []
        for parsed in result["transactions"]:
            rows.extend(rows_from_parsed({
                "date": parsed.get("date"),
                "time": parsed.get("time"),
                "merchant": parsed.get("merchant"),
                "category": parsed.get("category"),
                "subcategory": parsed.get("subcategory"),
                "original_amount": parsed.get("original_amount"),
                "original_currency": parsed.get("original_currency"),
                "payment_method": parsed.get("payment_method"),
                "notes": parsed.get("notes"),
                "tags": parsed.get("tags"),
                "source": placeholder.get("source"),
                "raw_input": placeholder.get("raw_input"),
                "receipt_id": tx_id,
            }, parsed, now))

        written = await finish_placeholder(session, tx_id, rows, now)
        await deduplicate_new_transactions(session, written)

        log.info("text-parse", "done",
                 {"txId": tx_id, "parsed": len(result["transactions"]), "rows": len(written)})
    except Exception as err:
        log.error("text-parse", "failed", err, {"txId": tx_id})
        await mark_failed(session.access_token, session.sheet_id, tx_id, err)
        raise

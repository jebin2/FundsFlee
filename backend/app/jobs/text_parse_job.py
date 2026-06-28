"""Text parse job — port of src/server/jobs/textParseJob.ts."""
from app.ai.parse_text import parse_transaction_text
from app.core.dates import today_iso, now_iso
from app.core.deps import SheetSession
from app.core.logger import log
from app.services.expand_items import expand_items_to_rows, item_quantity
from app.sheets import get_transaction_by_id, update_transaction_field


async def run_text_parse_job(session: SheetSession, tx_id: str, region: str = "") -> None:
    log.info("text-parse", "started", {"txId": tx_id})

    try:
        await update_transaction_field(session.access_token, session.sheet_id, tx_id, {"status": "processing"})
        placeholder = await get_transaction_by_id(session.access_token, session.sheet_id, tx_id)
        if not placeholder or not placeholder.get("raw_input"):
            await update_transaction_field(session.access_token, session.sheet_id, tx_id, {"status": "failed"})
            log.error("text-parse", "no raw_input on placeholder", None, {"txId": tx_id})
            return

        parsed = await parse_transaction_text(placeholder["raw_input"], region, today_iso())
        items = parsed.get("items") or []
        now = now_iso()

        if len(items) > 1:
            await expand_items_to_rows(session, tx_id, {
                "date": parsed.get("date"),
                "time": parsed.get("time"),
                "merchant": parsed.get("merchant"),
                "category": parsed.get("category"),
                "subcategory": parsed.get("subcategory"),
                "payment_method": parsed.get("payment_method"),
                "notes": parsed.get("notes"),
                "source": placeholder.get("source"),
                "raw_input": placeholder.get("raw_input"),
                "receipt_id": tx_id,
            }, items, now, parsed.get("amount"))
        else:
            single_item = items[0] if items else None
            await update_transaction_field(session.access_token, session.sheet_id, tx_id, {
                "date": parsed.get("date"),
                "time": parsed.get("time"),
                "amount": parsed.get("amount"),
                "merchant": parsed.get("merchant"),
                "category": parsed.get("category"),
                "subcategory": parsed.get("subcategory"),
                "item_name": single_item.get("name") if single_item and single_item.get("name") is not None else parsed.get("item_name"),
                "quantity": item_quantity(single_item.get("qty"), single_item.get("unit")) if single_item else None,
                "payment_method": parsed.get("payment_method"),
                "notes": parsed.get("notes"),
                "status": "done",
                "updated_at": now,
            })

        log.info("text-parse", "done",
                 {"txId": tx_id, "merchant": parsed.get("merchant"), "amount": parsed.get("amount"),
                  "itemCount": len(items)})
    except Exception as err:
        log.error("text-parse", "failed", err, {"txId": tx_id})
        try:
            await update_transaction_field(session.access_token, session.sheet_id, tx_id, {"status": "failed"})
        except Exception:
            pass
        raise

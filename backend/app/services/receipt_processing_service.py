"""Receipt processing — port of src/server/services/receiptProcessingService.ts."""
import asyncio
import base64
import math
import re

from app.ai.parse_image import parse_receipt_image
from app.core.dates import today_iso, now_iso
from app.core.deps import SheetSession
from app.core.logger import log
from app.core.numbers import to_locale_inr
from app.core.push import send_push_notification
from app.sheets import (
    download_receipt_from_drive,
    get_transaction_by_id,
    get_meta_values,
    update_transaction_field,
)
from app.services.duplicate_scan import deduplicate_new_transactions
from app.services.expand_items import finish_placeholder, rows_from_parsed

VALID_RECEIPT_MIME_TYPES = ("image/jpeg", "image/png", "image/webp")

_DRIVE_ID_RE = re.compile(r"/d/([a-zA-Z0-9_-]+)")


def _round(x: float) -> int:
    return math.floor(x + 0.5)


def _receipt_drive_file_id(receipt_url: str) -> str | None:
    m = _DRIVE_ID_RE.search(receipt_url)
    return m.group(1) if m else None


def _to_receipt_mime_type(mime_type: str) -> str:
    return mime_type if mime_type in VALID_RECEIPT_MIME_TYPES else "image/jpeg"


async def process_receipt(session: SheetSession, request: dict) -> dict:
    tx_id = request["txId"]
    log.info("receipt", "started", {"txId": tx_id})

    # Read before claiming the row. Marking a row "processing" and only then
    # discovering it does not exist writes nothing and loses the row's real
    # status, which is exactly the state this needs to report.
    placeholder = await get_transaction_by_id(session.access_token, session.sheet_id, tx_id)

    # Two different failures, kept apart on purpose: "no such row" means the id
    # never reached the store (or was deleted), while "row without a url" means
    # something dispatched a non-receipt transaction here. One log line for both
    # cannot tell them apart, so each says which, and the second carries the
    # source and status that explain how it came to be routed here at all.
    if not placeholder:
        log.error("receipt", "placeholder not found", None, {"txId": tx_id})
        return {"error": "Placeholder not found", "status": 404}
    if not placeholder.get("receipt_url"):
        log.error("receipt", "placeholder has no receipt_url", None,
                  {"txId": tx_id, "source": placeholder.get("source"),
                   "status": placeholder.get("status")})
        await update_transaction_field(session.access_token, session.sheet_id, tx_id, {"status": "failed"})
        return {"error": "Receipt URL not found", "status": 404}

    await update_transaction_field(session.access_token, session.sheet_id, tx_id, {"status": "processing"})

    try:
        file_id = _receipt_drive_file_id(placeholder["receipt_url"])
        if not file_id:
            log.error("receipt", "could not extract Drive file ID from URL", None,
                      {"txId": tx_id, "url": placeholder["receipt_url"]})
            await update_transaction_field(session.access_token, session.sheet_id, tx_id, {"status": "failed"})
            return {"error": "Could not extract file ID", "status": 400}

        log.info("receipt", "downloading image from Drive", {"txId": tx_id, "fileId": file_id})
        downloaded = await download_receipt_from_drive(session.access_token, file_id)
        buffer, mime_type = downloaded["buffer"], downloaded["mimeType"]

        log.info("receipt", "running AI parse", {"txId": tx_id, "mimeType": mime_type})
        result = await parse_receipt_image(
            base64.b64encode(buffer).decode(),
            _to_receipt_mime_type(mime_type),
            request.get("region"),
            today_iso(),
        )

        fallback = request.get("fallback")
        if fallback:
            for parsed in result["transactions"]:
                if not parsed.get("merchant"):
                    parsed["merchant"] = fallback.get("merchant")
                if not parsed.get("payment_method"):
                    parsed["payment_method"] = fallback.get("payment_method")

        receipt_id = request.get("receiptGroupId") or tx_id
        now = now_iso()
        parsed_rows = result["transactions"]

        log.info("receipt", "AI parsed",
                 {"txId": tx_id, "docType": result["docType"], "parsed": len(parsed_rows)})

        # A photographed statement page really can hold several payments.
        rows = []
        for parsed in parsed_rows:
            # Bank-reported amount is ground truth, but only when the photo
            # resolved to the single payment the placeholder was created for.
            total_amount = (placeholder["amount"]
                            if len(parsed_rows) == 1 and placeholder.get("amount") is not None
                            else parsed.get("amount"))
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
                "source": "receipt",
                "receipt_url": placeholder["receipt_url"],
                "receipt_id": receipt_id,
            }, parsed, now, total_amount))

        written = await finish_placeholder(session, tx_id, rows, now)
        await deduplicate_new_transactions(session, written)
        first = parsed_rows[0] if parsed_rows else {}

        try:
            meta = await get_meta_values(session.access_token, session.sheet_id)
        except Exception:
            meta = {}
        if meta.get("push_subscription"):
            item_n = len(written)
            payload = {
                "title": f"{first.get('merchant') or 'Receipt'} processed",
                "body": f"{item_n} row{'s' if item_n != 1 else ''} · ₹{to_locale_inr(_round(first.get('amount') or 0))}",
                "tag": "receipt-done",
                "url": "/transactions",
            }

            async def _push():
                try:
                    await send_push_notification(meta["push_subscription"], payload)
                except Exception as err:
                    log.warn("receipt", "push notification failed", {"txId": tx_id, "err": str(err)})

            asyncio.create_task(_push())

        log.info("receipt", "done",
                 {"txId": tx_id, "merchant": first.get("merchant"), "rows": len(written)})
        return {"ok": True, "txId": receipt_id, "itemCount": len(written)}
    except Exception as err:
        log.error("receipt", "failed", err, {"txId": tx_id})
        try:
            await update_transaction_field(session.access_token, session.sheet_id, tx_id, {"status": "failed"})
        except Exception:
            pass
        raise

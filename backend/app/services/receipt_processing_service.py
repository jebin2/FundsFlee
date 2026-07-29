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
from app.services.expand_items import finish_placeholder, priced_items, rows_from_parsed

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
    await update_transaction_field(session.access_token, session.sheet_id, tx_id, {"status": "processing"})

    try:
        placeholder = await get_transaction_by_id(session.access_token, session.sheet_id, tx_id)
        if not placeholder or not placeholder.get("receipt_url"):
            log.error("receipt", "no receipt_url on placeholder", None, {"txId": tx_id})
            await update_transaction_field(session.access_token, session.sheet_id, tx_id, {"status": "failed"})
            return {"error": "Placeholder or receipt URL not found", "status": 404}

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
        parsed = await parse_receipt_image(
            base64.b64encode(buffer).decode(),
            _to_receipt_mime_type(mime_type),
            request.get("region"),
            today_iso(),
        )

        fallback = request.get("fallback")
        if fallback:
            if not parsed.get("merchant"):
                parsed["merchant"] = fallback.get("merchant") or parsed.get("merchant")
            if not parsed.get("payment_method"):
                parsed["payment_method"] = fallback.get("payment_method") or parsed.get("payment_method")

        receipt_id = request.get("receiptGroupId") or tx_id
        now = now_iso()
        items = priced_items(parsed.get("items"))
        # Bank-reported amount is ground truth; OCR may miss items when confidence is low
        total_amount = placeholder["amount"] if placeholder.get("amount") is not None else parsed.get("amount")

        log.info("receipt", "AI parsed",
                 {"txId": tx_id, "merchant": parsed.get("merchant"), "amount": parsed.get("amount"),
                  "itemCount": len(items)})

        rows = rows_from_parsed({
            "date": parsed.get("date"),
            "time": parsed.get("time"),
            "merchant": parsed.get("merchant"),
            "category": parsed.get("category"),
            "subcategory": parsed.get("subcategory"),
            "payment_method": parsed.get("payment_method"),
            "notes": parsed.get("notes"),
            "tags": parsed.get("tags"),
            "source": "receipt",
            "receipt_url": placeholder["receipt_url"],
            "receipt_id": receipt_id,
        }, parsed, now, total_amount)
        written = await finish_placeholder(session, tx_id, rows, now)

        try:
            meta = await get_meta_values(session.access_token, session.sheet_id)
        except Exception:
            meta = {}
        if meta.get("push_subscription"):
            total = total_amount
            item_n = written
            payload = {
                "title": f"{parsed.get('merchant') or 'Receipt'} processed",
                "body": f"{item_n} item{'s' if item_n != 1 else ''} · ₹{to_locale_inr(_round(total))}",
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
                 {"txId": tx_id, "merchant": parsed.get("merchant"), "amount": parsed.get("amount"),
                  "rows": written})
        return {"ok": True, "txId": receipt_id, "itemCount": written}
    except Exception as err:
        log.error("receipt", "failed", err, {"txId": tx_id})
        try:
            await update_transaction_field(session.access_token, session.sheet_id, tx_id, {"status": "failed"})
        except Exception:
            pass
        raise

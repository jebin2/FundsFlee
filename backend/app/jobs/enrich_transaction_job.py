"""Enrich transaction job — port of src/server/jobs/enrichTransactionJob.ts."""
import base64
import time
import uuid
from datetime import datetime, timezone

from app.core.deps import SheetSession
from app.core.dates import now_iso
from app.core.logger import log
from app.jobs.text_parse_job import run_text_parse_job
from app.services.receipt_processing_service import process_receipt
from app.sheets import (
    append_transaction,
    get_all_transactions,
    get_or_create_receipts_folder,
    update_transaction_field,
    upload_receipt_to_drive,
)
from app.domain.transactions.failure import mark_failed

STALE_MS = 15 * 60 * 1000


def _age_ms(created_at: str) -> float:
    parsed = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - parsed).total_seconds() * 1000


async def prepare_receipt_retry(
    session: SheetSession, receipt_id: str, tx_context: dict | None
) -> str:
    """Soft-deletes all existing group items and appends a fresh "processing"
    placeholder. Returns the new placeholder txId. Call this in the route handler
    (before returning) so the client can refresh and immediately see the
    processing state."""
    log.info("enrich", "receipt retry — clearing group", {"receiptId": receipt_id})
    all_tx = await get_all_transactions(session.access_token, session.sheet_id)
    group_items = [t for t in all_tx if t.get("receipt_id") == receipt_id and not t.get("deleted")]

    # Idempotency: if a processing placeholder already exists, a concurrent retry is
    # already in flight — reuse it rather than creating a second orphaned placeholder.
    # Exception: if the placeholder is older than 15 min it was likely orphaned by a
    # server crash before the job could start, so fall through and replace it.
    existing = next((t for t in group_items if t.get("status") == "processing"), None)
    if existing:
        age_ms = _age_ms(existing["created_at"])
        if age_ms < STALE_MS:
            log.info("enrich", "receipt retry — already processing, reusing placeholder",
                     {"txId": existing["id"], "receiptId": receipt_id})
            return existing["id"]
        log.info("enrich", "receipt retry — stale placeholder, replacing",
                 {"txId": existing["id"], "ageMs": age_ms, "receiptId": receipt_id})
        # falls through — existing is included in group_items and will be soft-deleted below

    for item in group_items:
        await update_transaction_field(session.access_token, session.sheet_id, item["id"], {"deleted": True})

    now = now_iso()
    tx_id = str(uuid.uuid4())
    ctx = tx_context or {}
    await append_transaction(session.access_token, session.sheet_id, {
        "id": tx_id,
        "merchant": ctx.get("merchant") or "",
        "amount": ctx.get("amount") if ctx.get("amount") is not None else 0,
        "date": ctx.get("date") or now[:10],
        "time": ctx.get("time") or "",
        "payment_method": ctx.get("payment_method") or "UPI",
        "category": "",
        "source": "receipt",
        "receipt_id": receipt_id,
        "status": "processing",
        "created_at": now,
        "updated_at": now,
    })
    log.info("enrich", "receipt retry — placeholder created", {"txId": tx_id, "receiptId": receipt_id})
    return tx_id


def _build_enriched_raw_input(ctx: dict | None, user_text: str) -> str:
    if not ctx:
        return user_text
    lines = [
        f"Merchant: {ctx.get('merchant')}",
        f"Amount: ₹{ctx.get('amount')}",
        f"Date: {ctx.get('date')}",
        f"Time: {ctx.get('time')}" if ctx.get("time") else "",
        f"Payment: {ctx.get('payment_method')}",
        f"Notes: {ctx.get('notes')}" if ctx.get("notes") else "",
    ]
    lines = [ln for ln in lines if ln]
    joined = "\n".join(lines)
    return f"{joined}\n\nUser added:\n{user_text}"


async def run_enrich_transaction_job(session: SheetSession, input: dict) -> None:
    tx_id = input["txId"]
    receipt_id = input.get("receiptId")
    text = input.get("text")
    image_base64 = input.get("imageBase64")
    image_mime_type = input.get("imageMimeType")
    region = input.get("region") or ""
    tx_context = input.get("txContext")

    log.info("enrich", "started", {"txId": tx_id})

    try:
        if image_base64 and image_mime_type:
            folder_id = await get_or_create_receipts_folder(session.access_token, session.sheet_id)
            buffer = base64.b64decode(image_base64)
            ext = image_mime_type.split("/")[1] if "/" in image_mime_type else "jpg"
            uploaded = await upload_receipt_to_drive(
                session.access_token, folder_id, buffer,
                f"enrich-{tx_id}-{int(time.time() * 1000)}.{ext}", image_mime_type,
            )
            await update_transaction_field(session.access_token, session.sheet_id, tx_id,
                                           {"receipt_url": uploaded["viewUrl"]})
            result = await process_receipt(session, {
                "txId": tx_id,
                "region": region,
                "receiptGroupId": receipt_id,  # preserve original receipt_id grouping on retry
                "fallback": {
                    "merchant": tx_context.get("merchant"),
                    "payment_method": tx_context.get("payment_method"),
                } if tx_context else None,
            })
            if "error" in result:
                log.error("enrich", "processReceipt returned error", None, {"txId": tx_id, "error": result["error"]})
        elif text:
            combined = _build_enriched_raw_input(tx_context, text)
            await update_transaction_field(session.access_token, session.sheet_id, tx_id, {"raw_input": combined})
            await run_text_parse_job(session, tx_id, region)
    except Exception as err:
        log.error("enrich", "failed", err, {"txId": tx_id})
        await mark_failed(session.access_token, session.sheet_id, tx_id, err)

    log.info("enrich", "done", {"txId": tx_id})

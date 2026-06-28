"""Transactions endpoints — port of src/app/api/transactions/*."""
import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.dates import now_iso
from app.core.deps import SheetSession, require_session
from app.core.numbers import js_parse_int
from app.jobs.enrich_transaction_job import prepare_receipt_retry, run_enrich_transaction_job
from app.sheets import PAGE_SIZE, append_transaction, get_all_transactions, get_transactions, update_transaction_field

router = APIRouter()

VALID_TYPES = ("image/jpeg", "image/png", "image/webp")


@router.get("/api/transactions")
async def list_transactions(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    qp = request.query_params
    page = max(1, js_parse_int(qp.get("page", "1")))
    page_size = min(500, max(1, js_parse_int(qp.get("pageSize", str(PAGE_SIZE)))))
    return await get_transactions(session.access_token, session.sheet_id, page, page_size)


@router.post("/api/transactions")
async def create_transaction(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    body = await request.json()
    transaction = body["transaction"]
    now = now_iso()
    tx = {
        **transaction,
        "id": transaction.get("id") or str(uuid.uuid4()),
        "created_at": transaction.get("created_at") or now,
        "updated_at": now,
    }
    await append_transaction(session.access_token, session.sheet_id, tx)
    return {"transaction": tx}


@router.put("/api/transactions/{tx_id}")
async def put_transaction(tx_id: str, request: Request, session: SheetSession = Depends(require_session)) -> dict:
    body = await request.json()
    await update_transaction_field(session.access_token, session.sheet_id, tx_id, body["updates"])
    return {"ok": True}


@router.patch("/api/transactions/{tx_id}")
async def patch_transaction(tx_id: str, request: Request, session: SheetSession = Depends(require_session)) -> dict:
    updates = await request.json()
    await update_transaction_field(session.access_token, session.sheet_id, tx_id, updates)
    return {"ok": True, "updates": updates}


@router.delete("/api/transactions/{tx_id}")
async def delete_transaction(tx_id: str, session: SheetSession = Depends(require_session)) -> dict:
    # If other transactions point to this one as their duplicate original, clear their
    # flags so they don't show orphaned Keep/Remove buttons after deletion.
    all_txs = await get_all_transactions(session.access_token, session.sheet_id)
    orphaned = [t for t in all_txs if t.get("duplicate_ref") == tx_id and t.get("is_duplicate")]
    if orphaned:
        await asyncio.gather(*[
            update_transaction_field(session.access_token, session.sheet_id, t["id"], {
                "is_duplicate": False,
                "duplicate_ref": None,
            })
            for t in orphaned
        ])

    await update_transaction_field(session.access_token, session.sheet_id, tx_id, {"deleted": True})
    return {"ok": True}


@router.post("/api/transactions/{tx_id}/enrich")
async def enrich_transaction(tx_id: str, request: Request, session: SheetSession = Depends(require_session)) -> dict:
    form = await request.form()
    text = form.get("text")
    image = form.get("image")
    region = form.get("region") or ""

    if not (text and text.strip()) and not image:
        raise HTTPException(status_code=400, detail="text or image required")

    tx_context = None
    raw = form.get("txContext")
    if isinstance(raw, str):
        try:
            tx_context = json.loads(raw)
        except Exception:
            pass  # ignore malformed

    receipt_id = form.get("receiptId") or None

    image_base64 = None
    image_mime_type = None
    if image:
        if image.content_type not in VALID_TYPES:
            raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP supported")
        import base64
        image_base64 = base64.b64encode(await image.read()).decode()
        image_mime_type = image.content_type

    # For receipt retries, soft-delete old items and create the new placeholder *before*
    # returning so the client's refresh() sees the "processing" state immediately.
    work_tx_id = tx_id
    if receipt_id:
        try:
            work_tx_id = await prepare_receipt_retry(session, receipt_id, tx_context)
        except Exception:
            raise HTTPException(status_code=500, detail="Failed to prepare receipt retry")

    async def _job():
        try:
            await run_enrich_transaction_job(session, {
                "txId": work_tx_id,
                "receiptId": receipt_id,
                "text": (text.strip() if text and text.strip() else None),
                "imageBase64": image_base64,
                "imageMimeType": image_mime_type,
                "region": region,
                "txContext": tx_context,
            })
        except Exception:
            pass

    asyncio.create_task(_job())
    return {"ok": True}

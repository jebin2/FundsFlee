"""Parsing endpoints — synchronous text/image/statement parsers plus the async
job and manual-retry variants. All of them go through app.ai.parser."""
import asyncio
import base64

from fastapi import APIRouter, Depends, HTTPException, Request

from app.ai.parse_image import parse_receipt_image
from app.ai.parser import NO_FLOOR, parse_units
from app.ai.parse_text import parse_transaction_text
from app.core.dates import today_iso
from app.extract.pipeline import collect_units
from app.core.deps import SheetSession, require_session
from app.jobs.statement_parse_job import run_statement_parse_job
from app.jobs.text_parse_job import run_text_parse_job
from app.use_cases.create_statement_import_request import create_statement_import_request
from app.use_cases.create_text_parse_request import create_text_parse_request

router = APIRouter()

VALID_TYPES = ("image/jpeg", "image/png", "image/webp")

# ── Synchronous parsers ──────────────────────────────────────────────────────
@router.post("/api/parse/text")
async def parse_text(request: Request, _session: SheetSession = Depends(require_session)) -> dict:
    body = await request.json()
    text = body.get("text")
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    result = await parse_transaction_text(text, body.get("region"), today_iso())
    # The add form edits one transaction, so the first row is what it can show.
    extracted = (result["transactions"] or [{}])[0]
    return {"extracted": extracted, "confidence": extracted.get("confidence")}


@router.post("/api/parse/image")
async def parse_image(request: Request, _session: SheetSession = Depends(require_session)) -> dict:
    form = await request.form()
    image = form.get("image")
    region = form.get("region")
    if not image:
        raise HTTPException(status_code=400, detail="image is required")
    if image.content_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP supported")
    b64 = base64.b64encode(await image.read()).decode()
    result = await parse_receipt_image(b64, image.content_type, region or None, today_iso())
    extracted = (result["transactions"] or [{}])[0]
    return {"extracted": extracted, "confidence": extracted.get("confidence")}


@router.post("/api/parse/statement")
async def parse_statement(request: Request, _session: SheetSession = Depends(require_session)) -> dict:
    form = await request.form()
    file = form.get("file")

    if not file:
        raise HTTPException(status_code=400, detail="file is required")
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    units = await collect_units(data, "application/pdf", file.filename or "statement.pdf")
    broken = next((u for u in units if u["kind"] == "error"), None)
    if broken:
        # Encrypted or unreadable — the reason is written for the user.
        raise HTTPException(status_code=400, detail=broken["reason"])

    parsed = await parse_units(units, "", today_iso(),
                               min_confidence=NO_FLOOR, apply_cheap_guards=False)
    if parsed["skipReason"] == "parse_error":
        raise HTTPException(status_code=500, detail="Could not parse AI response")

    return {"transactions": parsed["transactions"]}


# ── Async job + manual retry ─────────────────────────────────────────────────
@router.post("/api/parse/text/async")
async def parse_text_async(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    body = await request.json()
    text = body.get("text")
    region = body.get("region", "")
    if not (text and text.strip()):
        raise HTTPException(status_code=400, detail="text required")
    result = await create_text_parse_request(session, text, region)
    return {"ok": True, "txId": result["txId"]}


@router.post("/api/parse/text/process")
async def parse_text_process(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    qp = request.query_params
    tx_id = qp.get("txId")
    region = qp.get("region", "")
    if not tx_id:
        raise HTTPException(status_code=400, detail="txId required")

    async def _job():
        try:
            await run_text_parse_job(session, tx_id, region)
        except Exception:
            pass

    asyncio.create_task(_job())
    return {"ok": True}


@router.post("/api/parse/statement/async")
async def parse_statement_async(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    form = await request.form()
    file = form.get("file")

    if not file:
        raise HTTPException(status_code=400, detail="file required")
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    result = await create_statement_import_request(session, data, file.filename or "")
    return {"ok": True, "txId": result["txId"]}


@router.post("/api/parse/statement/process")
async def parse_statement_process(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    tx_id = request.query_params.get("txId")
    if not tx_id:
        raise HTTPException(status_code=400, detail="txId required")

    async def _job():
        try:
            await run_statement_parse_job(session, tx_id)
        except Exception:
            pass

    asyncio.create_task(_job())
    return {"ok": True}

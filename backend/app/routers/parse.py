"""Parsing endpoints — port of src/app/api/parse/*.

Includes the synchronous text/image/statement parsers and the async job +
manual-retry variants. The statement parser here has its OWN verbatim system
prompt (more detailed than the background job's).
"""
import asyncio
import base64
import json
import re

from anthropic import AsyncAnthropic
from fastapi import APIRouter, Depends, HTTPException, Request

from app.ai.parse_image import parse_receipt_image
from app.ai.parse_text import parse_transaction_text
from app.config import settings
from app.core.dates import today_iso
from app.core.deps import SheetSession, require_session
from app.jobs.statement_parse_job import run_statement_parse_job
from app.jobs.text_parse_job import run_text_parse_job
from app.use_cases.create_statement_import_request import create_statement_import_request
from app.use_cases.create_text_parse_request import create_text_parse_request

router = APIRouter()

VALID_TYPES = ("image/jpeg", "image/png", "image/webp")
_OBJECT_RE = re.compile(r"\{[\s\S]*\}")

SYSTEM_PROMPT = """You are a bank statement parser for an Indian spending tracker.
Extract all debit transactions from the provided bank statement PDF.

Respond with valid JSON only:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "amount": number (INR, positive for debits),
      "merchant": string (payee/description, cleaned up),
      "category": string (one of: Food & Dining, Transport, Shopping, Entertainment, Health, Bills & Utilities, Education, Personal Care, Gifts & Donations, Others),
      "payment_method": "UPI" | "Card" | "NetBanking" | "Cash" | "Other",
      "notes": string or null (reference number or original description)
    }
  ]
}

Rules:
- Only include debits (money going out), not credits (incoming money)
- Clean up merchant names (e.g. "UPI/918888/SWIGGY" → "Swiggy")
- If a transaction description is unclear, put it in notes and set merchant to the raw description
- Infer category from merchant name when possible"""


# ── Synchronous parsers ──────────────────────────────────────────────────────
@router.post("/api/parse/text")
async def parse_text(request: Request, _session: SheetSession = Depends(require_session)) -> dict:
    body = await request.json()
    text = body.get("text")
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    extracted = await parse_transaction_text(text, body.get("region"), today_iso())
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
    extracted = await parse_receipt_image(b64, image.content_type, region or None, today_iso())
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

    b64 = base64.b64encode(data).decode()

    client = AsyncAnthropic(api_key=settings.anthropic_api_key or None)
    msg = await client.messages.create(
        model=settings.ai_model or "claude-sonnet-4-6",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": [
                {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}},
                {"type": "text", "text": f"Today's date is {today_iso()}. Extract all debit transactions from this bank statement."},
            ],
        }],
    )

    block = msg.content[0]
    if block.type != "text":
        raise HTTPException(status_code=500, detail="Unexpected AI response")

    json_match = _OBJECT_RE.search(block.text)
    if not json_match:
        raise HTTPException(status_code=500, detail="Could not parse AI response")

    try:
        parsed = json.loads(json_match.group(0))
    except Exception:
        raise HTTPException(status_code=500, detail="Could not parse AI response")

    return {"transactions": parsed.get("transactions") or []}


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

    result = await create_statement_import_request(session, data)
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

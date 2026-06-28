"""Duplicate endpoints — port of src/app/api/duplicates/*."""
import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.deps import SheetSession, require_session
from app.services.duplicate_detection_service import run_duplicate_detection
from app.sheets import get_meta_values
from app.use_cases.create_merge_request import create_merge_request

router = APIRouter()

RUN_INTERVAL_MS = 60 * 60 * 1000


@router.post("/api/duplicates/detect")
async def detect(session: SheetSession = Depends(require_session)) -> dict:
    # Check cooldown — if within 1 hour, skip
    meta = await get_meta_values(session.access_token, session.sheet_id)
    last_run_iso = meta.get("last_dedup_checked_at")
    last_run = (
        datetime.fromisoformat(last_run_iso.replace("Z", "+00:00")).timestamp() * 1000
        if last_run_iso else 0
    )
    now_ms = datetime.now(timezone.utc).timestamp() * 1000

    if now_ms - last_run < RUN_INTERVAL_MS:
        return {"skipped": True}

    # Fire BG — returns immediately, dedup_running_at tracked in sheet
    async def _job():
        try:
            await run_duplicate_detection(session)
        except Exception:
            pass

    asyncio.create_task(_job())
    return {"started": True}


@router.post("/api/duplicates/merge")
async def merge(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    body = await request.json()
    transaction_ids = body.get("transactionIds")
    if not transaction_ids or len(transaction_ids) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 transaction IDs to merge")
    result = await create_merge_request(session, transaction_ids)
    return {"ok": True, **result}

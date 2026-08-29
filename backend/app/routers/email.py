"""Email import endpoints — port of src/app/api/email/*."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.deps import SheetSession, require_session
from app.services.email_import_service import (
    get_email_import_status,
    request_email_import,
    save_email_import_config,
)
from app.services.email_rerun_service import RerunError, preview, rerun
from app.sheets import get_parsed_email_stats

router = APIRouter()


@router.get("/api/email/config")
async def email_config_get(session: SheetSession = Depends(require_session)) -> dict:
    return await get_email_import_status(session)


@router.put("/api/email/config")
async def email_config_put(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    body = await request.json()
    await save_email_import_config(session, body)
    return {"ok": True}


@router.post("/api/email/fetch")
async def email_fetch(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    manual = request.query_params.get("manual") == "1"
    request_email_import(session, manual)
    return {"ok": True, "message": "Email import started in background."}


@router.get("/api/email/status")
async def email_status(session: SheetSession = Depends(require_session)) -> dict:
    status, stats = await asyncio.gather(
        get_email_import_status(session),
        get_parsed_email_stats(session.access_token, session.sheet_id),
    )
    return {
        **status,
        "emailsScanned": stats["total"],
        "emailsParsed": stats["parsed"],
        "emailsPartial": stats["partial"],
        "emailsSkipped": stats["skipped"],
        "emailsFailed": stats["failed"],
        "emailsGaveUp": stats["failedPermanent"],
    }


# Re-reading one mail. Split in two on purpose: a mail can hold several
# payments, so a re-run can discard rows the person edited, and the preview is
# what lets them see that before it happens.
@router.get("/api/email/rerun/preview")
async def email_rerun_preview(request: Request,
                              session: SheetSession = Depends(require_session)) -> dict:
    tx_id = request.query_params.get("txId")
    if not tx_id:
        raise HTTPException(status_code=400, detail="txId required")
    try:
        return await preview(session, tx_id)
    except RerunError as err:
        raise HTTPException(status_code=err.status, detail=str(err))


@router.post("/api/email/rerun")
async def email_rerun(request: Request,
                      session: SheetSession = Depends(require_session)) -> dict:
    body = await request.json()
    tx_id = body.get("txId")
    if not tx_id:
        raise HTTPException(status_code=400, detail="txId required")
    try:
        return await rerun(session, tx_id)
    except RerunError as err:
        raise HTTPException(status_code=err.status, detail=str(err))

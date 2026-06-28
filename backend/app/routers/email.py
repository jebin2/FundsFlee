"""Email import endpoints — port of src/app/api/email/*."""
import asyncio

from fastapi import APIRouter, Depends, Request

from app.core.deps import SheetSession, require_session
from app.services.email_import_service import (
    get_email_import_status,
    request_email_import,
    save_email_import_config,
)
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
        "emailsSkipped": stats["skipped"],
        "emailsFailed": stats["failed"],
    }

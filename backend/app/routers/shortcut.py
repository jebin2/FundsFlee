"""iOS Shortcut endpoints — port of src/app/api/shortcut/*.

POST /api/shortcut uses the shortcut-JWT (NOT the session cookie); the file/
install routes use the in-memory prepare-ID. Paths must not change — installed
shortcuts hardcode them.
"""

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from app.ai.parse_text import parse_transaction_text
from app.services.expand_items import rows_from_parsed
from app.config import settings
from app.core.dates import now_iso, today_iso
from app.core.deps import SheetSession, require_session
from app.core.google_oauth import refresh_google_token
from app.core.logger import log
from app.core.shortcut_plist import build_shortcut_file
from app.core.shortcut_prepare import get_shortcut_prepare, store_shortcut_prepare
from app.sheets import append_transactions, get_meta_values, set_meta_value

router = APIRouter()


@router.post("/api/shortcut")
async def shortcut(request: Request) -> dict:
    auth = request.headers.get("authorization")
    if not auth or not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")

    token = auth[7:]
    try:
        payload = jwt.decode(token, settings.jwt_secret or "change-me", algorithms=["HS256"])
        if not payload.get("email") or not payload.get("sheetId"):
            raise ValueError("Invalid payload")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    body = await request.json()
    text = body.get("text")
    source = body.get("source", "shortcut")
    if not text:
        raise HTTPException(status_code=400, detail="text required")

    if not payload.get("refreshToken"):
        raise HTTPException(status_code=401, detail="Token is outdated — please reinstall the shortcut from the app.")

    access_token = await refresh_google_token(payload["refreshToken"])
    if not access_token:
        raise HTTPException(status_code=401, detail="Could not authenticate — please reinstall the shortcut from the app.")

    result = await parse_transaction_text(text, payload.get("region") or "", today_iso())

    now = now_iso()
    rows = []
    for parsed in result["transactions"]:
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
            "source": source,
            "raw_input": text,
        }, parsed, now))

    await append_transactions(access_token, payload["sheetId"], rows)
    # Installed shortcuts read a single object here, so an itemised bill
    # reports its first row rather than changing the response shape.
    tx = rows[0] if rows else {}

    await set_meta_value(access_token, payload["sheetId"], "shortcut_last_used", now_iso())

    return {"entry": tx}


@router.post("/api/shortcut/prepare")
async def prepare(session: SheetSession = Depends(require_session)) -> dict:
    meta = await get_meta_values(session.access_token, session.sheet_id)
    token = meta.get("shortcut_token")
    if not token:
        raise HTTPException(status_code=404, detail="No shortcut token found — reload the page and try again.")
    prepare_id = store_shortcut_prepare(token)
    log.info("shortcut", "prepare created", {"prepareId": prepare_id[:8]})
    return {"prepareId": prepare_id}


async def _shortcut_file(request: Request) -> Response:
    prepare_id = request.query_params.get("id")
    log.info("shortcut", "file download request", {"prepareId": prepare_id[:8] if prepare_id else "none"})

    if not prepare_id:
        raise HTTPException(status_code=400, detail="id required")

    token = get_shortcut_prepare(prepare_id)
    if not token:
        log.warn("shortcut", "prepare id not found or expired", {"prepareId": prepare_id[:8]})
        raise HTTPException(status_code=401, detail="Invalid or expired install link — tap Install Shortcut again.")

    log.info("shortcut", "building shortcut file")
    origin = f"{request.url.scheme}://{request.url.netloc}"
    buf = build_shortcut_file(token, origin)

    return Response(
        content=buf,
        media_type="application/x-apple-shortcut",
        headers={
            "Content-Disposition": 'attachment; filename="FundsFlee.shortcut"',
            "Content-Length": str(len(buf)),
            "Cache-Control": "no-store",
        },
    )


# Duplicate route — iOS needs the `.shortcut` URL suffix. Same implementation.
@router.get("/api/shortcut/file")
async def shortcut_file(request: Request) -> Response:
    return await _shortcut_file(request)


@router.get("/api/shortcut/install.shortcut")
async def shortcut_install(request: Request) -> Response:
    return await _shortcut_file(request)

"""User/profile endpoints — port of src/app/api/user/profile + user/token."""
import json
import time

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request

from app.config import settings
from app.core.deps import SheetSession, load_user, require_session
from app.core.safe_json import safe_json_parse
from app.sheets import get_meta_values, set_meta_value

router = APIRouter()


def _generate_token(email: str, sheet_id: str, refresh_token: str, region: str) -> str:
    payload = {
        "email": email,
        "sheetId": sheet_id,
        "purpose": "shortcut",
        "refreshToken": refresh_token,
        "region": region,
        "iat": int(time.time()),
    }
    return jwt.encode(payload, settings.jwt_secret or "change-me", algorithm="HS256")


@router.get("/api/user/profile")
async def profile_get(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    user = await load_user(request)
    google_name = (user or {}).get("name") or ""
    meta = await get_meta_values(session.access_token, session.sheet_id)
    return {
        "name": meta.get("name") or google_name or "",
        "region": meta.get("region") or "",
        "lifestyle_tags": safe_json_parse(meta.get("lifestyle_tags"), []),
        "monthly_income": float(meta["monthly_income"]) if meta.get("monthly_income") else None,
        "shortcut_token": meta.get("shortcut_token") or "",
        "shortcut_last_used": meta.get("shortcut_last_used") or "",
        "sheet_url": meta.get("sheet_url") or "",
        "receipts_folder_id": meta.get("receipts_folder_id") or "",
    }


def _stringify(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


@router.put("/api/user/profile")
async def profile_put(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    fields = await request.json()
    for key, value in fields.items():
        if value is not None:
            await set_meta_value(session.access_token, session.sheet_id, key, _stringify(value))
    return {"ok": True}


@router.get("/api/user/token")
async def token_get(session: SheetSession = Depends(require_session)) -> dict:
    return await _token(session)


@router.post("/api/user/token")
async def token_post(session: SheetSession = Depends(require_session)) -> dict:
    return await _token(session)


async def _token(session: SheetSession) -> dict:
    if not session.user_email:
        raise HTTPException(status_code=401, detail="Unauthorized")
    meta = await get_meta_values(session.access_token, session.sheet_id)
    token = _generate_token(session.user_email, session.sheet_id, session.refresh_token or "", meta.get("region") or "")
    await set_meta_value(session.access_token, session.sheet_id, "shortcut_token", token)
    return {"token": token}

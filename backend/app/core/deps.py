"""Session dependency — port of src/server/http/requireSession.ts on top of
google-auth-service. The lib session cookie identifies the user; the Google
access token comes from the credential store (auto-refreshed by the lib).
"""
from dataclasses import dataclass

from fastapi import HTTPException, Request

from app.core.auth import google_auth, user_store
from app.cron.sync_scheduler import remember_owner


@dataclass
class SheetSession:
    """What route handlers receive — mirrors SheetSession in services/types.ts."""
    access_token: str
    refresh_token: str
    sheet_id: str
    user_email: str | None = None


async def load_user(request: Request) -> dict | None:
    """Resolve the session cookie (or Bearer token) to a user record.
    Returns None when there is no valid session."""
    token = request.cookies.get(google_auth.cookie_name)
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        return None

    try:
        payload = google_auth.jwt.verify_token(token)
    except Exception:
        return None

    version = await user_store.get_token_version(payload.user_id)
    if version is not None and payload.token_version != version:
        return None  # session revoked via logout

    return await user_store.get(payload.user_id)


async def require_session(request: Request) -> SheetSession:
    """401 {"error": "Unauthorized"} unless a usable session exists —
    same gate as requireSession.ts (needs Google access AND a sheet)."""
    user = await load_user(request)
    if not user or not user.get("sheet_id"):
        raise HTTPException(status_code=401, detail="Unauthorized")

    access_token = await google_auth.get_google_access_token(user["user_id"])
    if not access_token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # The syncer runs on a timer, with no request to borrow a token from. This
    # is where it learns whose credentials to use for this sheet.
    remember_owner(user["sheet_id"], user["user_id"])

    credentials = await user_store.get_credentials(user["user_id"]) or {}
    return SheetSession(
        access_token=access_token,
        refresh_token=credentials.get("refresh_token", ""),
        sheet_id=user["sheet_id"],
        user_email=user.get("email"),
    )

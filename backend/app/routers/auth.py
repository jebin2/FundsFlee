"""FundsFlee auth endpoints on top of google-auth-service.

The lib router (mounted in main.py) provides:
    GET  /auth/google/authorize   — 302 to Google consent
    GET  /auth/google/callback    — code exchange, session cookie, redirect
    POST /auth/logout             — revoke + clear cookie
    GET  /auth/me                 — raw user record

This module adds the FundsFlee-specific surface from API.md:
    GET /auth/login               — alias for /auth/google/authorize
    GET /api/auth/session         — replaces NextAuth useSession()
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from app.core.auth import google_auth
from app.core.deps import load_user

router = APIRouter()


@router.get("/auth/login")
async def login() -> RedirectResponse:
    return RedirectResponse("/auth/google/authorize", status_code=307)


@router.get("/api/auth/session")
async def session(request: Request) -> dict:
    user = await load_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Unauthorized")

    body: dict = {
        "user": {
            "name": user.get("name") or "",
            "email": user.get("email") or "",
            "image": user.get("picture") or "",
        },
        "sheet_id": user.get("sheet_id") or "",
        "sheet_is_new": bool(user.get("sheet_is_new")),
    }

    # Google refresh no longer works (revoked access etc.) — surface the
    # same signal NextAuth did so the client can force a re-login.
    if await google_auth.get_google_access_token(user["user_id"]) is None:
        body["error"] = "RefreshTokenError"
    return body

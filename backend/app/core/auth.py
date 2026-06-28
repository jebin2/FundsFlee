"""FundsFlee auth — built on the google-auth-service library.

The lib owns: Google OAuth code flow (offline access), session JWT cookie,
user + Google-credential persistence (FileUserStore), token refresh.
FundsFlee plugs in: sheet bootstrap on sign-in (hook) and the
onboarding redirect for new users.
"""
from typing import Any

from fastapi import Request
from google_auth_service import AuthHooks, FileUserStore, GoogleAuth

from app.config import settings
from app.core.logger import log
from app.sheets.init import init_spending_sheet

OAUTH_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/gmail.readonly",
]

user_store = FileUserStore(settings.user_store_file)


class FundsFleeHooks(AuthHooks):
    async def on_oauth_credentials(self, user: Any, credentials: dict, request: Request, is_new_user: bool = False) -> None:
        """Initialize (or find) the user's FundsFlee spreadsheet right after
        Google credentials land — mirrors the NextAuth jwt-callback behavior
        in the old src/lib/auth.ts."""
        try:
            result = await init_spending_sheet(credentials["access_token"], user.get("name") or "User")
            await user_store.update_fields(
                user["user_id"],
                sheet_id=result["sheetId"],
                sheet_url=result["sheetUrl"],
                sheet_is_new=result["isNew"],
            )
            log.info("auth", "sheet ready", {"sheet": result["sheetId"][:8], "new": result["isNew"]})
        except Exception as e:
            log.error("auth", "failed to init sheet during sign-in", e)

    async def on_login_error(self, error: Exception, request: Request) -> None:
        log.error("auth", "login failed", error)


def _post_login_redirect(user: Any, _request: Request) -> str:
    return "/onboarding" if user.get("sheet_is_new") else "/"


google_auth = GoogleAuth(
    client_id=settings.google_client_id,
    client_secret=settings.google_client_secret,
    jwt_secret=settings.session_secret,
    oauth_scopes=OAUTH_SCOPES,
    oauth_redirect_uri=f"{settings.base_url}/auth/google/callback",
    user_store=user_store,
    cookie_name=settings.session_cookie,
    cookie_secure=settings.base_url.startswith("https://"),
    refresh_expiry_days=30,  # session lifetime — NextAuth default was 30 days
    hooks=FundsFleeHooks(),
    post_login_redirect=_post_login_redirect,
    error_redirect="/?auth_error=1",
)

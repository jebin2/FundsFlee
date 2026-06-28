"""Google OAuth refresh — port of src/lib/googleAuth.ts.

Used only by the iOS shortcut endpoint, whose JWT carries its own Google
refresh token (independent of the FileUserStore credential flow).
"""
import httpx

from app.config import settings


async def refresh_google_token(refresh_token: str) -> str | None:
    """Exchange a Google refresh token for an access token; None on failure."""
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://oauth2.googleapis.com/token",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                },
            )
        if res.status_code >= 400:
            return None
        return res.json().get("access_token")
    except Exception:
        return None

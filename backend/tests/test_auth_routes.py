import asyncio
import time

from fastapi.testclient import TestClient
from google_auth_service import GoogleUserInfo

from app.core.auth import google_auth, user_store
from app.main import app

client = TestClient(app)

GOOGLE_INFO = GoogleUserInfo(
    google_id="123456789", email="a@b.c", name="A", picture="http://img"
)


def make_session(sheet_id: str = "sheet123", creds_valid: bool = True) -> str:
    """Create a user record + credentials in the store, return a session JWT."""
    async def setup():
        user = await user_store.save(GOOGLE_INFO)
        await user_store.update_fields(user["user_id"], sheet_id=sheet_id, sheet_is_new=False)
        await user_store.save_credentials(user["user_id"], {
            "access_token": "g-access",
            "refresh_token": "g-refresh",
            "expires_at": time.time() + (3000 if creds_valid else -10),
            "scopes": "",
        })
        return user
    user = asyncio.run(setup())
    return google_auth.jwt.create_refresh_token(
        user_id=user["user_id"], email=user["email"], token_version=1
    )


def test_healthz():
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_session_endpoint_unauthorized_envelope():
    r = client.get("/api/auth/session")
    assert r.status_code == 401
    assert r.json() == {"error": "Unauthorized"}  # exact envelope per API.md


def test_session_endpoint_with_cookie():
    token = make_session()
    r = client.get("/api/auth/session", cookies={google_auth.cookie_name: token})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["email"] == "a@b.c"
    assert body["sheet_id"] == "sheet123"
    assert "error" not in body


def test_session_reports_refresh_error(monkeypatch):
    token = make_session(creds_valid=False)
    monkeypatch.setattr(google_auth.code_flow, "refresh_access_token", lambda rt: None)
    r = client.get("/api/auth/session", cookies={google_auth.cookie_name: token})
    assert r.status_code == 200
    assert r.json()["error"] == "RefreshTokenError"


def test_protected_route_requires_session():
    r = client.post("/api/sheet/init")
    assert r.status_code == 401
    assert r.json() == {"error": "Unauthorized"}


def test_protected_route_with_session():
    token = make_session()
    r = client.post("/api/sheet/init", cookies={google_auth.cookie_name: token})
    assert r.status_code == 200
    assert r.json() == {
        "sheetId": "sheet123",
        "sheetUrl": "https://docs.google.com/spreadsheets/d/sheet123/edit",
        "isNew": False,
    }


def test_protected_route_rejects_session_without_sheet():
    token = make_session(sheet_id="")
    r = client.post("/api/sheet/init", cookies={google_auth.cookie_name: token})
    assert r.status_code == 401


def test_login_alias_redirects_to_lib_authorize():
    r = client.get("/auth/login", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"] == "/auth/google/authorize"


def test_authorize_redirects_to_google_with_scopes():
    r = client.get("/auth/google/authorize", follow_redirects=False)
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "access_type=offline" in loc and "prompt=consent" in loc
    for scope in ("spreadsheets", "drive.file", "gmail.readonly"):
        assert scope in loc


def test_logout_clears_cookie():
    r = client.post("/auth/logout")
    assert r.status_code == 200 and r.json()["success"] is True
    assert google_auth.cookie_name in r.headers.get("set-cookie", "")


def test_session_revoked_after_logout():
    token = make_session()
    r = client.post("/auth/logout", cookies={google_auth.cookie_name: token})
    assert r.status_code == 200
    # token_version was bumped — old session JWT no longer valid
    r = client.get("/api/auth/session", cookies={google_auth.cookie_name: token})
    assert r.status_code == 401

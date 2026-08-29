from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment configuration. Reads ../.env.local first, then
    backend/.env, which overrides it."""

    model_config = SettingsConfigDict(
        env_file=("../.env.local", ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    # Public origin of the deployed app (API + SPA on one host).
    base_url: str = "http://localhost:8000"
    session_secret: str = "change-me"
    session_cookie: str = "fundsflee_session"

    @field_validator("base_url")
    @classmethod
    def _strip_trailing_slash(cls, v: str) -> str:
        # A trailing slash (BASE_URL=…com/) would build the OAuth redirect as
        # …com//auth/google/callback → redirect_uri_mismatch.
        return v.rstrip("/")

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""

    # Signs the tokens embedded in installed iOS Shortcuts. Changing it
    # invalidates every shortcut already installed — they must be re-downloaded.
    jwt_secret: str = "change-me"

    # AI
    ai_provider: str = "opencode"
    ai_model: str | None = None
    anthropic_api_key: str = ""
    gemini_api_key: str = ""
    opencode_api_url: str = "https://ttt.voidall.com"
    ocr_api_url: str = "https://jebin2-ocr.hf.space"
    # Sent as X-API-Key on every call to either TTT backend (OpenCode and OCR
    # share one key); they reject requests without it.
    ttt_api_key: str = ""

    # Web push (VAPID)
    vapid_public_key: str = ""
    vapid_private_key: str = ""

    # Cron session file — same path/format as the Next.js app
    cron_session_file: str = "data/cron-session.json"

    # google-auth-service FileUserStore (users + Google credentials)
    user_store_file: str = "data/users.json"

    # Where nightly snapshots go. The default is on the same disk as the data
    # it protects, which covers corruption and mistakes but not losing the
    # machine — point this at another volume if you have one.
    backup_dir: str = "data/backups"

    # Built SPA to serve (single-origin deploy). Empty → default ../frontend/dist
    # relative to the repo; unset/missing in dev (SPA runs on the Vite dev server).
    frontend_dist: str = ""


settings = Settings()

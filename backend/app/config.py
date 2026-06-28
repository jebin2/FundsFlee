from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment configuration. Mirrors the keys used by the Next.js app
    (see API.md "Implementation notes") so the same env can drive both
    stacks during the migration: reads ../.env.local (the Next.js file)
    first, then backend/.env overrides."""

    model_config = SettingsConfigDict(
        env_file=("../.env.local", ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    # Server. Reuses the Next.js app's NEXTAUTH_URL on the server so the same
    # .env.local drives both stacks (set BASE_URL to override explicitly).
    base_url: str = Field(
        default="http://localhost:8000",
        validation_alias=AliasChoices("BASE_URL", "NEXTAUTH_URL"),
    )
    # Falls back to the existing AUTH_SECRET (NextAuth) so sessions can be
    # signed without adding a new env key.
    session_secret: str = Field(
        default="change-me",
        validation_alias=AliasChoices("SESSION_SECRET", "AUTH_SECRET"),
    )
    session_cookie: str = "fundsflee_session"

    @field_validator("base_url")
    @classmethod
    def _strip_trailing_slash(cls, v: str) -> str:
        # A trailing slash (e.g. NEXTAUTH_URL=…com/) would build the OAuth
        # redirect as …com//auth/google/callback → redirect_uri_mismatch.
        return v.rstrip("/")

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""

    # Shortcut JWT — MUST keep the value deployed with the Next.js app,
    # otherwise already-installed iOS Shortcuts break.
    jwt_secret: str = "change-me"

    # AI — defaults mirror the TS providerChain.ts / providers
    ai_provider: str = "opencode"
    ai_model: str | None = None
    anthropic_api_key: str = ""
    gemini_api_key: str = ""
    opencode_api_url: str = "https://opencode.voidall.com"

    # Web push (VAPID)
    vapid_public_key: str = ""
    vapid_private_key: str = ""

    # Cron session file — same path/format as the Next.js app
    cron_session_file: str = "data/cron-session.json"

    # google-auth-service FileUserStore (users + Google credentials)
    user_store_file: str = "data/users.json"

    # Built SPA to serve (single-origin deploy). Empty → default ../frontend/dist
    # relative to the repo; unset/missing in dev (SPA runs on the Vite dev server).
    frontend_dist: str = ""


settings = Settings()

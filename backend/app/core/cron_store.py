"""Cron session store — port of src/lib/cron/cronStore.ts.

Persists a single user's refresh token + sheet id so the server-side scheduler
can run jobs without a browser session. Same file format/path as the Next.js
app (already deployed): data/cron-session.json, mode 0600.
"""
import json
import os

from app.config import settings

_FILE = settings.cron_session_file


def save_cron_session(session: dict) -> None:
    directory = os.path.dirname(_FILE)
    if directory and not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)
    with open(_FILE, "w", encoding="utf-8") as f:
        json.dump(session, f, indent=2)
    os.chmod(_FILE, 0o600)


def load_cron_session() -> dict | None:
    try:
        if not os.path.exists(_FILE):
            return None
        with open(_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def cron_session_exists() -> bool:
    return os.path.exists(_FILE)

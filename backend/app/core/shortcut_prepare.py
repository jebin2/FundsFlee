"""In-memory shortcut prepare-ID store — port of src/lib/shortcutPrepare.ts.

Maps a short UUID → the full shortcut JWT (too long for a URL). Entries expire
after 10 minutes. Single-process only (per API.md implementation notes).
"""
import time
import uuid

_store: dict[str, dict] = {}
_TTL_MS = 10 * 60 * 1000


def _now_ms() -> float:
    return time.time() * 1000


def store_shortcut_prepare(token: str) -> str:
    prepare_id = str(uuid.uuid4())
    _store[prepare_id] = {"token": token, "expiresAt": _now_ms() + _TTL_MS}
    return prepare_id


def get_shortcut_prepare(prepare_id: str) -> str | None:
    entry = _store.get(prepare_id)
    if not entry:
        return None
    if _now_ms() > entry["expiresAt"]:
        del _store[prepare_id]
        return None
    return entry["token"]

"""Email import config reader — port of src/server/email-import/emailImportConfig.ts."""
from datetime import datetime, timezone

from app.core.deps import SheetSession
from app.core.numbers import js_parse_int
from app.core.safe_json import safe_json_parse
from app.sheets import get_meta_values


# The lock is cleared in a finally block, which does not run if the process is
# killed mid-import — a restart, an OOM, a deploy. Past this age the lock is
# assumed abandoned so it blocks neither the next run nor the UI.
LOCK_STALE_SECONDS = 5 * 60


def active_running_at(running_at: str | None) -> str | None:
    """The lock value, or None once it is old enough to be abandoned.

    Every reader must go through this. The job applied the age rule and the
    status endpoint did not, so a killed run left the settings screen saying
    "Scanning emails…" indefinitely while the job itself had long since moved
    on.
    """
    if not running_at:
        return None
    try:
        started = datetime.fromisoformat(running_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    age = (datetime.now(timezone.utc) - started).total_seconds()
    return running_at if age < LOCK_STALE_SECONDS else None


async def read_email_import_config(session: SheetSession) -> dict:
    meta = await get_meta_values(session.access_token, session.sheet_id)
    return {
        "fromContains": safe_json_parse(meta.get("email_import_from_contains"), []),
        "subjectContains": safe_json_parse(meta.get("email_import_subject_contains"), []),
        "daysBack": js_parse_int(meta.get("email_import_days_back"), 0) or 0,
        "region": meta.get("region") or "",
        # On unless explicitly switched off. Statements and forwarded alerts
        # carry their content in attachments, so reading them is the useful
        # default; the toggle exists for when the AI cost is not wanted.
        "attachments": meta.get("email_import_attachments") != "0",
        "lastRun": meta.get("email_import_last_run") or None,
        "txCount": js_parse_int(meta.get("email_import_tx_count"), 0) or 0,
        "runningAt": active_running_at(meta.get("email_import_running_at")),
    }

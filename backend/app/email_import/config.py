"""Email import config reader — port of src/server/email-import/emailImportConfig.ts."""
from app.core.deps import SheetSession
from app.core.numbers import js_parse_int
from app.core.safe_json import safe_json_parse
from app.sheets import get_meta_values


async def read_email_import_config(session: SheetSession) -> dict:
    meta = await get_meta_values(session.access_token, session.sheet_id)
    return {
        "fromContains": safe_json_parse(meta.get("email_import_from_contains"), []),
        "daysBack": js_parse_int(meta.get("email_import_days_back")) if meta.get("email_import_days_back") else 7,
        "region": meta.get("region") or "",
        "lastRun": meta.get("email_import_last_run") or None,
        "txCount": js_parse_int(meta.get("email_import_tx_count"), 0) or 0,
        "runningAt": meta.get("email_import_running_at") or None,
    }

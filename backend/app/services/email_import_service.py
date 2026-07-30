"""Email import service — port of src/server/services/emailImportService.ts."""
import asyncio
import json

from app.core.deps import SheetSession
from app.core.logger import log
from app.core.numbers import js_parse_int
from app.core.safe_json import safe_json_parse
from app.email_import.config import active_running_at
from app.sheets import get_meta_values, set_meta_values


async def save_email_import_config(session: SheetSession, update: dict) -> None:
    """One batched write. Four separate set_meta_value calls meant four reads
    and four writes for a single Save, which is how a settings change could
    exhaust the 60-reads-per-minute quota on its own."""
    values: dict[str, str] = {}

    if update.get("fromContains") is not None:
        values["email_import_from_contains"] = json.dumps(
            update["fromContains"], ensure_ascii=False, separators=(",", ":"))
    if update.get("subjectContains") is not None:
        values["email_import_subject_contains"] = json.dumps(
            update["subjectContains"], ensure_ascii=False, separators=(",", ":"))
    if update.get("daysBack") is not None:
        values["email_import_days_back"] = str(update["daysBack"])
    if update.get("attachments") is not None:
        values["email_import_attachments"] = "1" if update["attachments"] else "0"

    await set_meta_values(session.access_token, session.sheet_id, values)


async def get_email_import_status(session: SheetSession) -> dict:
    meta = await get_meta_values(session.access_token, session.sheet_id)
    return {
        "fromContains": safe_json_parse(meta.get("email_import_from_contains"), []),
        "subjectContains": safe_json_parse(meta.get("email_import_subject_contains"), []),
        "daysBack": js_parse_int(meta.get("email_import_days_back"), 0) or 0,
        "attachments": meta.get("email_import_attachments") != "0",
        "lastRun": meta.get("email_import_last_run") or None,
        "totalTxImported": js_parse_int(meta.get("email_import_tx_count"), 0) or 0,
        "runningAt": active_running_at(meta.get("email_import_running_at")),
    }


# Trigger the email import job as a fire-and-forget background task.
# Returns immediately; job runs asynchronously.
def request_email_import(session: SheetSession, manual: bool = False) -> None:
    from app.jobs.email_import_job import run_email_import_job

    async def _run():
        try:
            await run_email_import_job(session, manual)
        except Exception as err:
            log.error("email", "job threw unexpectedly", err)

    asyncio.create_task(_run())

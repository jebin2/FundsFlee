"""Duplicate detection service — port of src/server/services/duplicateDetectionService.ts."""
import asyncio
from datetime import datetime, timezone

from app.ai.dedup import find_duplicates
from app.core.dates import now_iso as _now_iso
from app.core.deps import SheetSession
from app.core.logger import log
from app.sheets import (
    get_all_transactions,
    get_meta_values,
    set_meta_value,
    update_transaction_field,
)

RUN_INTERVAL_MS = 60 * 60 * 1000


def _now_ms() -> float:
    return datetime.now(timezone.utc).timestamp() * 1000


def _epoch_ms(iso: str | None) -> float:
    if not iso:
        return 0
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000


def _is_ai_unavailable_error(err: Exception) -> bool:
    message = str(err)
    return (
        "API key" in message
        or "API Key" in message
        or "quota" in message
        or "429" in message
        or "503" in message
    )


async def run_duplicate_detection(session: SheetSession) -> None:
    log.info("dedup", "started")
    try:
        await set_meta_value(session.access_token, session.sheet_id, "dedup_running_at", _now_iso())
    except Exception:
        pass

    try:
        transactions = await get_all_transactions(session.access_token, session.sheet_id)
        log.info("dedup", f"scanning {len(transactions)} transactions", None)

        previous_duplicates = [tx for tx in transactions if tx.get("is_duplicate")]
        if previous_duplicates:
            log.info("dedup", f"clearing {len(previous_duplicates)} previous duplicate flags", None)
            await asyncio.gather(*[
                update_transaction_field(session.access_token, session.sheet_id, tx["id"], {
                    "is_duplicate": False,
                    "duplicate_ref": None,
                })
                for tx in previous_duplicates
            ])

        groups = await find_duplicates(transactions)
        log.info("dedup", f"found {len(groups)} duplicate group(s)", None)

        if groups:
            await asyncio.gather(*[
                update_transaction_field(session.access_token, session.sheet_id, duplicate_id, {
                    "is_duplicate": True,
                    "duplicate_ref": group["original_id"],
                })
                for group in groups
                for duplicate_id in group["duplicate_ids"]
            ])

        await set_meta_value(session.access_token, session.sheet_id, "last_dedup_checked_at", _now_iso())
        log.info("dedup", "done")
    finally:
        try:
            await set_meta_value(session.access_token, session.sheet_id, "dedup_running_at", "")
        except Exception:
            pass


async def request_duplicate_detection(session: SheetSession) -> dict:
    meta = await get_meta_values(session.access_token, session.sheet_id)
    last_run = _epoch_ms(meta.get("last_dedup_checked_at"))

    if _now_ms() - last_run < RUN_INTERVAL_MS:
        return {"skipped": True}

    try:
        await run_duplicate_detection(session)
        return {"done": True}
    except Exception as err:
        log.error("dedup", "detection failed", err)
        return {"error": "ai_unavailable" if _is_ai_unavailable_error(err) else "detection_failed"}

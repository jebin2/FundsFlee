"""Analysis job — port of src/server/jobs/analysisJob.ts."""
import json

from app.ai.analyze import analyze_spending
from app.core.deps import SheetSession
from app.core.logger import log
from app.core.periods import get_period_range
from app.sheets import get_all_transactions, store_analysis_in_drive, upsert_analysis_cache_row

ANALYSIS_CELL_LIMIT = 40000


async def run_analysis_job(
    session: SheetSession, period: str, region: str, lifestyle_tags: list[str]
) -> None:
    rng = get_period_range(period)
    from_, to, label = rng["from"], rng["to"], rng["label"]
    log.info("analysis", "started", {"period": period, "from": from_, "to": to})
    try:
        all_tx = await get_all_transactions(session.access_token, session.sheet_id)
        filtered = [t for t in all_tx if from_ <= t["date"] <= to]
        log.info("analysis", f"running AI on {len(filtered)} transactions", None)
        result = await analyze_spending(filtered, label, region, lifestyle_tags)
        result_json = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        needs_drive = len(result_json) > ANALYSIS_CELL_LIMIT
        drive_file_id = (
            await store_analysis_in_drive(session.access_token, session.sheet_id, period, result_json)
            if needs_drive else ""
        )
        await upsert_analysis_cache_row(
            session.access_token, session.sheet_id, period, period, "done",
            "" if needs_drive else result_json, drive_file_id,
        )
        log.info("analysis", "done", {"period": period, "drive": needs_drive})
    except Exception as err:
        log.error("analysis", "failed", err, {"period": period})
        try:
            await upsert_analysis_cache_row(session.access_token, session.sheet_id, period, period, "failed")
        except Exception:
            pass

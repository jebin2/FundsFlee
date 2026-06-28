"""Comparison job — port of src/server/jobs/comparisonJob.ts."""
import json

from app.ai.compare import compare_merchants
from app.core.deps import SheetSession
from app.core.logger import log
from app.core.periods import get_period_range
from app.services.comparison_service import compare_key
from app.sheets import get_all_transactions, store_analysis_in_drive, upsert_analysis_cache_row

COMPARE_CELL_LIMIT = 40000


async def run_comparison_job(
    session: SheetSession, merchants: list[str], period: str, region: str
) -> None:
    key = compare_key(merchants, period)
    log.info("compare", "started", {"merchants": ",".join(merchants), "period": period})
    try:
        rng = get_period_range(period)
        from_, to = rng["from"], rng["to"]
        all_tx = await get_all_transactions(session.access_token, session.sheet_id)
        filtered = [t for t in all_tx if from_ <= t["date"] <= to]
        log.info("compare", f"running AI on {len(filtered)} transactions", None)
        result = await compare_merchants(merchants, filtered, period, region)
        result_json = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        needs_drive = len(result_json) > COMPARE_CELL_LIMIT
        drive_file_id = (
            await store_analysis_in_drive(session.access_token, session.sheet_id, key, result_json)
            if needs_drive else ""
        )
        await upsert_analysis_cache_row(
            session.access_token, session.sheet_id, key, "compare", "done",
            "" if needs_drive else result_json, drive_file_id,
        )
        log.info("compare", "done", {"key": key, "drive": needs_drive})
    except Exception as err:
        log.error("compare", "failed", err, {"key": key})
        try:
            await upsert_analysis_cache_row(session.access_token, session.sheet_id, key, "compare", "failed")
        except Exception:
            pass

"""Analysis service — port of src/server/services/analysisService.ts."""
import asyncio
import json
import math
from datetime import datetime, timezone

from app.core.deps import SheetSession
from app.core.logger import log
from app.sheets import get_analysis_cache, get_analysis_from_drive, upsert_analysis_cache_row
from app.ai import analysis_shape as shape

CACHE_FRESH_MS = 24 * 60 * 60 * 1000


def _round(x: float) -> int:
    return math.floor(x + 0.5)


def _age_ms(iso: str) -> float:
    return (datetime.now(timezone.utc) - datetime.fromisoformat(iso.replace("Z", "+00:00"))).total_seconds() * 1000


async def _read_cached_analysis(session: SheetSession, period: str) -> dict:
    cached = await get_analysis_cache(session.access_token, session.sheet_id, period, float("inf"))
    if not cached:
        return {"status": "not_started"}
    if cached["status"] == "generating":
        return {"status": "generating"}
    if cached["status"] == "failed":
        return {"status": "failed"}

    summary_json = cached.get("summary_json")
    if not summary_json and cached.get("drive_file_id"):
        summary_json = await get_analysis_from_drive(session.access_token, cached["drive_file_id"])
    if not summary_json:
        return {"status": "not_started"}  # cache row exists but data missing

    try:
        return {
            "status": "done",
            # Normalised on the way out too: rows cached before the shape
            # was enforced still hold objects where sentences belong, and
            # would keep crashing the tab until they were regenerated.
            "analysis": shape.normalise(json.loads(summary_json)),
            "generated_at": cached["generated_at"],
        }
    except Exception:
        return {"status": "failed"}


async def get_analysis_status(session: SheetSession, period: str) -> dict:
    return await _read_cached_analysis(session, period)


async def request_analysis(session: SheetSession, request: dict) -> dict:
    from app.jobs.analysis_job import run_analysis_job

    period = request.get("period") or "month"
    current = await get_analysis_cache(session.access_token, session.sheet_id, period, float("inf"))

    if current and current["status"] == "generating":
        log.info("analysis", "already generating — skipping", {"period": period})
        return {"status": "generating"}

    if not request.get("force_refresh") and current and current["status"] == "done":
        age_ms = _age_ms(current["generated_at"])
        if age_ms < CACHE_FRESH_MS:
            log.info("analysis", "cache hit — returning cached", {"period": period, "ageS": _round(age_ms / 1000)})
            return await _read_cached_analysis(session, period)
        log.info("analysis", "cache stale — regenerating", {"period": period, "ageS": _round(age_ms / 1000)})

    log.info("analysis", "triggering AI job", {"period": period, "force": bool(request.get("force_refresh"))})
    await upsert_analysis_cache_row(session.access_token, session.sheet_id, period, period, "generating")

    async def _job():
        try:
            await run_analysis_job(session, period, request.get("region") or "", request.get("lifestyle_tags") or [])
        except Exception as err:
            log.error("analysis", "job failed", err, {"period": period})

    asyncio.create_task(_job())

    return {"status": "generating"}

"""Comparison service — port of src/server/services/comparisonService.ts."""
import asyncio
import json
import math
from datetime import datetime, timezone

from app.core.deps import SheetSession
from app.core.logger import log
from app.sheets import get_analysis_cache, get_analysis_from_drive, upsert_analysis_cache_row

CACHE_FRESH_MS = 24 * 60 * 60 * 1000


def _round(x: float) -> int:
    return math.floor(x + 0.5)


def _age_ms(iso: str) -> float:
    return (datetime.now(timezone.utc) - datetime.fromisoformat(iso.replace("Z", "+00:00"))).total_seconds() * 1000


def compare_key(merchants: list[str], period: str) -> str:
    return f"compare_{'|'.join(sorted(merchants))}_{period}"


async def _read_cached_comparison(session: SheetSession, key: str) -> dict:
    cached = await get_analysis_cache(session.access_token, session.sheet_id, key, float("inf"))
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
            "result": json.loads(summary_json),
            "generated_at": cached["generated_at"],
        }
    except Exception:
        return {"status": "failed"}


async def get_comparison_status(session: SheetSession, merchants: list[str], period: str) -> dict:
    if len(merchants) < 2:
        return {"status": "not_started"}
    return await _read_cached_comparison(session, compare_key(merchants, period))


async def request_comparison(session: SheetSession, request: dict) -> dict:
    from app.jobs.comparison_job import run_comparison_job

    merchants = request.get("merchants") or []
    period = request.get("period") or "month"
    if len(merchants) < 2:
        return {"error": "Select at least 2 merchants"}

    key = compare_key(merchants, period)
    current = await get_analysis_cache(session.access_token, session.sheet_id, key, float("inf"))

    if current and current["status"] == "generating":
        log.info("compare", "already generating — skipping", {"key": key})
        return {"status": "generating"}

    if not request.get("force_refresh") and current and current["status"] == "done":
        age_ms = _age_ms(current["generated_at"])
        if age_ms < CACHE_FRESH_MS:
            log.info("compare", "cache hit — returning cached", {"key": key, "ageS": _round(age_ms / 1000)})
            return await _read_cached_comparison(session, key)
        log.info("compare", "cache stale — regenerating", {"key": key, "ageS": _round(age_ms / 1000)})

    log.info("compare", "triggering AI job", {"key": key, "force": bool(request.get("force_refresh"))})
    await upsert_analysis_cache_row(session.access_token, session.sheet_id, key, "compare", "generating")

    async def _job():
        try:
            await run_comparison_job(session, merchants, period, request.get("region") or "")
        except Exception as err:
            log.error("compare", "job failed", err, {"key": key})

    asyncio.create_task(_job())

    return {"status": "generating"}

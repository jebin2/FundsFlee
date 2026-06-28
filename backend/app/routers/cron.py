"""Cron endpoints — port of src/app/api/cron/*."""
import asyncio
import json
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.cron_store import cron_session_exists, save_cron_session
from app.core.dates import now_iso
from app.core.deps import SheetSession, require_session
from app.core.logger import log
from app.core.numbers import js_parse_int
from app.jobs.analysis_job import run_analysis_job
from app.jobs.email_import_job import run_email_import_job
from app.services.duplicate_detection_service import run_duplicate_detection
from app.services.email_import_service import request_email_import
from app.sheets import get_analysis_cache_for_periods, get_meta_values, set_meta_value, upsert_analysis_cache_row

router = APIRouter()

ANALYSIS_PERIODS = ["week", "month", "year"]


def _now_ms() -> float:
    return datetime.now(timezone.utc).timestamp() * 1000


def _epoch_ms(iso: str | None) -> float:
    if not iso:
        return 0
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000


async def _run_all_analysis(session: SheetSession) -> str:
    try:
        meta = await get_meta_values(session.access_token, session.sheet_id)
    except Exception:
        meta = {}
    region = meta.get("region") or ""
    lifestyle_tags = json.loads(meta["lifestyle_tags"]) if meta.get("lifestyle_tags") else []
    results = []
    for period in ANALYSIS_PERIODS:
        try:
            await run_analysis_job(session, period, region, lifestyle_tags)
            results.append(f"{period}=done")
        except Exception:
            results.append(f"{period}=failed")
    return " ".join(results)


@router.post("/api/cron/register")
async def cron_register(session: SheetSession = Depends(require_session)) -> dict:
    if not session.refresh_token:
        return {"ok": False, "reason": "no refresh token in session"}
    save_cron_session({
        "refreshToken": session.refresh_token,
        "sheetId": session.sheet_id,
        "userEmail": session.user_email or "",
        "savedAt": now_iso(),
    })
    return {"ok": True}


@router.post("/api/cron/run")
async def cron_run(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    job = request.query_params.get("job") or "all"

    if job == "all":
        log.info("cron", "manual run all — email → dedup → analysis (sequential)")
        results: dict[str, str] = {}

        try:
            r = await run_email_import_job(session, manual=True)
            results["email"] = f"done (scanned={r['scanned']} imported={r['imported']} skipped={r['skipped']})"
        except Exception as err:
            log.error("cron", "email import failed", err)
            results["email"] = "failed"

        try:
            await run_duplicate_detection(session)
            results["dedup"] = "done"
        except Exception as err:
            log.error("cron", "dedup failed", err)
            results["dedup"] = "failed"

        try:
            results["analysis"] = await _run_all_analysis(session)
        except Exception as err:
            log.error("cron", "analysis failed", err)
            results["analysis"] = "failed"

        log.info("cron", "manual run all complete", results)
        return {"ok": True, "results": results}

    if job == "email":
        log.info("cron", "manual run email")
        request_email_import(session, manual=True)
        return {"ok": True, "job": "email", "status": "started (background)"}

    if job == "dedup":
        log.info("cron", "manual run dedup")
        await run_duplicate_detection(session)
        return {"ok": True, "job": "dedup", "status": "done"}

    if job == "analysis":
        log.info("cron", "manual run analysis — week, month, year")
        result = await _run_all_analysis(session)
        return {"ok": True, "job": "analysis", "status": result}

    raise HTTPException(status_code=400, detail="Unknown job")


def _is_still_running(running_at: str | None, last_run: str | None, max_ms: float = 10 * 60 * 1000) -> bool:
    if not running_at:
        return False
    age = _now_ms() - _epoch_ms(running_at)
    if age >= max_ms:
        return False  # stale — server restart leak
    if last_run and _epoch_ms(last_run) > _epoch_ms(running_at):
        return False  # already finished
    return True


@router.get("/api/cron/status")
async def cron_status(session: SheetSession = Depends(require_session)) -> dict:
    meta, analysis_by_period = await asyncio.gather(
        get_meta_values(session.access_token, session.sheet_id),
        get_analysis_cache_for_periods(session.access_token, session.sheet_id, ["week", "month", "year"]),
    )

    email_running_at = meta.get("email_import_running_at") or None
    email_last_run = meta.get("email_import_last_run") or None
    dedup_running_at = meta.get("dedup_running_at") or None
    dedup_last_run = meta.get("last_dedup_checked_at") or None

    def _analysis_stuck(period: dict | None) -> bool:
        if not period or period.get("status") != "generating":
            return False
        age_ms = _now_ms() - _epoch_ms(period["generated_at"]) if period.get("generated_at") else math.inf
        return age_ms < 10 * 60 * 1000

    def _period_block(period: dict | None) -> dict:
        return {
            "lastRun": (period.get("generated_at") if period else None) or None,
            "status": "generating" if _analysis_stuck(period) else ((period.get("status") if period else None) or None),
        }

    from_contains = json.loads(meta["email_import_from_contains"]) if meta.get("email_import_from_contains") else []

    return {
        "registered": cron_session_exists(),
        "email": {
            "lastRun": email_last_run,
            "runningAt": email_running_at if _is_still_running(email_running_at, email_last_run) else None,
            "txCount": js_parse_int(meta.get("email_import_tx_count"), 0) or 0,
            "enabled": len(from_contains) > 0,
        },
        "dedup": {
            "lastRun": dedup_last_run,
            "runningAt": dedup_running_at if _is_still_running(dedup_running_at, dedup_last_run) else None,
        },
        "analysis": {
            "week": _period_block(analysis_by_period.get("week")),
            "month": _period_block(analysis_by_period.get("month")),
            "year": _period_block(analysis_by_period.get("year")),
        },
        "schedule": "12:00 IST daily",
    }


@router.post("/api/cron/clear")
async def cron_clear(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    job = request.query_params.get("job") or "all"

    clears = []
    if job in ("email", "all"):
        clears.append(set_meta_value(session.access_token, session.sheet_id, "email_import_running_at", ""))
    if job in ("dedup", "all"):
        clears.append(set_meta_value(session.access_token, session.sheet_id, "dedup_running_at", ""))
    if job in ("analysis", "all"):
        for period in ["week", "month", "year"]:
            clears.append(upsert_analysis_cache_row(session.access_token, session.sheet_id, period, period, "cancelled"))
    await asyncio.gather(*clears)

    return {"ok": True}

"""Server-side scheduler — port of src/lib/cron/scheduler.ts.

node-cron → APScheduler (AsyncIOScheduler). Runs the daily maintenance jobs at
12:00 IST using the credentials persisted by POST /api/cron/register.
"""
import json
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.cron_store import load_cron_session
from app.core.deps import SheetSession
from app.core.google_oauth import refresh_google_token
from app.core.logger import log
from app.jobs.analysis_job import run_analysis_job
from app.jobs.comparison_job import run_comparison_job
from app.jobs.email_import_job import run_email_import_job
from app.jobs.merge_job import retry_failed_merges
from app.services.duplicate_detection_service import run_duplicate_detection
from app.sheets import (
    get_all_transactions,
    get_analysis_cache_rows_by_status,
    get_meta_values,
    update_transaction_field,
)

STUCK_THRESHOLD_MS = 30 * 60 * 1000  # 30 minutes


def _epoch_ms(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000


# Mark transactions stuck in "processing" or "merging" as failed.
# A restart mid-job leaves these statuses permanently set — the cron cleans them up.
async def _cleanup_stuck_transactions(session: SheetSession) -> None:
    all_tx = await get_all_transactions(session.access_token, session.sheet_id)
    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    stuck = []
    for t in all_tx:
        if t.get("status") not in ("processing", "merging"):
            continue
        age = now_ms - _epoch_ms(t.get("updated_at") or t.get("created_at"))
        if age >= STUCK_THRESHOLD_MS:
            stuck.append(t)
    if not stuck:
        return
    log.info("cron", f"cleanup: marking {len(stuck)} stuck transaction(s) as failed")
    for tx in stuck:
        failed_status = "merge_failed" if tx.get("status") == "merging" else "failed"
        try:
            await update_transaction_field(session.access_token, session.sheet_id, tx["id"], {"status": failed_status})
        except Exception as err:
            log.error("cron", "cleanup: failed to mark tx", err, {"id": tx["id"]})


async def run_daily_jobs() -> dict:
    stored = load_cron_session()
    if not stored:
        log.warn("cron", "no credentials stored — open the app once to register")
        return {"email": "skipped (not registered)", "dedup": "skipped (not registered)"}

    access_token = await refresh_google_token(stored["refreshToken"])
    if not access_token:
        log.error("cron", "failed to refresh Google access token")
        return {"email": "failed (auth)", "dedup": "failed (auth)"}

    session = SheetSession(
        access_token=access_token,
        refresh_token=stored["refreshToken"],
        sheet_id=stored["sheetId"],
        user_email=stored.get("userEmail"),
    )

    # ── 0. Cleanup stuck transactions from previous server run ───────────────
    try:
        await _cleanup_stuck_transactions(session)
    except Exception as err:
        log.error("cron", "stuck-tx cleanup failed", err)

    # ── 1. Email import ───────────────────────────────────────────────────────
    email_result = "ok"
    try:
        log.info("cron", "starting email import")
        await run_email_import_job(session)
        log.info("cron", "email import done")
    except Exception as err:
        log.error("cron", "email import failed", err)
        email_result = "failed"

    # ── 2. Duplicate detection ────────────────────────────────────────────────
    dedup_result = "ok"
    try:
        log.info("cron", "starting duplicate detection")
        await run_duplicate_detection(session)
        log.info("cron", "duplicate detection done")
    except Exception as err:
        log.error("cron", "duplicate detection failed", err)
        dedup_result = "failed"

    # ── 3. Retry failed merges ────────────────────────────────────────────────
    try:
        await retry_failed_merges(session)
    except Exception as err:
        log.error("cron", "merge retry pass failed", err)

    # ── 4. Analysis — week, month, year (sequential) ──────────────────────────
    try:
        meta = await get_meta_values(session.access_token, session.sheet_id)
    except Exception:
        meta = {}
    region = meta.get("region") or ""
    lifestyle_tags = json.loads(meta["lifestyle_tags"]) if meta.get("lifestyle_tags") else []

    for period in ("week", "month", "year"):
        try:
            log.info("cron", f"starting analysis: {period}")
            await run_analysis_job(session, period, region, lifestyle_tags)
            log.info("cron", f"analysis done: {period}")
        except Exception as err:
            log.error("cron", f"analysis failed: {period}", err)

    # ── 5. Retry failed comparisons ───────────────────────────────────────────
    try:
        failed_rows = await get_analysis_cache_rows_by_status(session.access_token, session.sheet_id, "failed")
        for row in failed_rows:
            if not row["period"].startswith("compare_"):
                continue
            parts = row["period"].replace("compare_", "").split("_")
            p = parts.pop() if parts else "month"
            merchants = "_".join(parts).split("|")
            if len(merchants) >= 2:
                log.info("cron", f"retrying failed comparison: {row['period']}")
                try:
                    await run_comparison_job(session, merchants, p, region)
                except Exception as err:
                    log.error("cron", "comparison retry failed", err, {"period": row["period"]})
    except Exception as err:
        log.error("cron", "comparison retry pass failed", err)

    return {"email": email_result, "dedup": dedup_result}


_scheduler: AsyncIOScheduler | None = None


def init_cron_scheduler() -> AsyncIOScheduler:
    """Start the daily 12:00 IST scheduler. Idempotent."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    async def _job():
        log.info("cron", "daily job triggered at 12:00 IST")
        await run_daily_jobs()

    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(_job, CronTrigger(hour=12, minute=0, timezone="Asia/Kolkata"))
    _scheduler.start()
    log.info("cron", "scheduler initialised — daily at 12:00 IST")
    return _scheduler


def shutdown_cron_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None

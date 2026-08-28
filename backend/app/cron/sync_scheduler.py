"""Runs the syncer: every minute, and once on the way down.

Getting a token is the awkward part. Writes are local now, so a change can be
queued by a request, a cron job, or an import that finished just before a
restart — and at push time there may be no session in flight to borrow a token
from. So the work list comes from the disk (every mirror with a queue) and the
token is looked up per sheet:

  a signed-in user, whose credentials the auth library already holds and
  refreshes, remembered here by sheet id as requests come through; or

  the stored cron session, which is what makes an unattended server work — it
  is the same credential the daily jobs run on.

A sheet with neither is left queued rather than dropped. Nothing is lost by
waiting: the queue is on disk, and the next sign-in pushes it.
"""
import asyncio

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.core.cron_store import load_cron_session
from app.core.google_oauth import refresh_google_token
from app.core.logger import log
from app.db.sync import push, sheets_with_pending

# A minute is the promise the design was built on: a change is in the sheet
# within a minute, and a burst of writes in that minute costs one push.
PUSH_INTERVAL_SECONDS = 60

# sheet id -> user id, for sheets whose owner has been seen this process.
_owners: dict[str, str] = {}


def remember_owner(sheet_id: str, user_id: str) -> None:
    """Called as sessions come through, so the syncer can get a token later."""
    if sheet_id and user_id:
        _owners[sheet_id] = user_id


async def _access_token_for(sheet_id: str) -> str | None:
    user_id = _owners.get(sheet_id)
    if user_id:
        # Imported here: app.core.auth builds the sheet bootstrap hook, which
        # reaches back into app.sheets.
        from app.core.auth import google_auth
        token = await google_auth.get_google_access_token(user_id)
        if token:
            return token

    stored = load_cron_session()
    if stored and stored.get("sheetId") == sheet_id:
        return await refresh_google_token(stored["refreshToken"])
    return None


async def push_pending() -> dict[str, dict]:
    """One pass over every sheet with queued changes."""
    results: dict[str, dict] = {}
    for sheet_id in sheets_with_pending():
        token = await _access_token_for(sheet_id)
        if not token:
            log.warn("sync", "changes queued but no usable credential",
                     {"sheetId": sheet_id[:8]})
            continue
        try:
            results[sheet_id] = await push(token, sheet_id)
        except Exception as err:
            # push_sync isolates per-tab failures; this catches the rest —
            # a dead token, an unreachable API. The queue survives either way.
            log.error("sync", "push failed", err, {"sheetId": sheet_id[:8]})
    return results


_scheduler: AsyncIOScheduler | None = None


def init_sync_scheduler() -> AsyncIOScheduler:
    """Start the push loop. Idempotent."""
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(
        push_pending,
        IntervalTrigger(seconds=PUSH_INTERVAL_SECONDS),
        # A slow push must not stack: the next tick would claim the same rows
        # and write them twice concurrently.
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    log.info("sync", f"syncer started — every {PUSH_INTERVAL_SECONDS}s")
    return _scheduler


async def shutdown_sync_scheduler() -> None:
    """Stop the loop after one last push.

    Without this a restart strands up to a minute of writes until someone signs
    in again. They are safe on disk either way — this just means the sheet is
    current when the server goes down cleanly, which is most of the time.
    """
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
    try:
        await asyncio.wait_for(push_pending(), timeout=30)
    except Exception as err:
        log.warn("sync", "final push skipped", {"error": str(err)[:200]})

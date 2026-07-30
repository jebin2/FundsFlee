"""Dual-write: every sheet write is also applied locally.

Phase 2. The sheet is still authoritative and still serves every read — this
only keeps the local mirror in step, so that Phase 3 can flip reads over to it
with evidence rather than hope.

The plan originally had Phase 2 flip reads first and leave writes going straight
to Sheets. That is wrong: reads served from a mirror nothing updates go stale on
the first write. Dual-write has to come first, and it is also the phase that can
be verified — run the app normally, then diff the mirror against the sheet.

**Failures here are logged, not raised.** For this phase only. Sheets remains
the source of truth, so a mirror that misses a write costs nothing except drift,
which verify.py detects. The moment reads move over in Phase 3 that inverts, and
these become hard failures.

**Every function here must be called AFTER the sheet write has succeeded.** That
ordering is what makes the bootstrap correct: if the mirror does not exist yet,
hydration reads a sheet that already contains this write, so the write must not
then be applied a second time.
"""
import threading

from app.core.logger import log
from app.db.connection import connect, mirror_exists
from app.db.registry import spec
from app.db.repo import Repo

# One hydration check per sheet per process. hydrate_sync is cheap when the file
# exists, but it still opens a connection and counts six tables.
_ready: set[str] = set()
_ready_guard = threading.Lock()


def _ensure(access_token: str, sheet_id: str) -> bool:
    """Make sure a mirror exists. Returns True if it was built during THIS call.

    The lock is held across hydration rather than around the memo alone: two
    threads that both saw a missing mirror would otherwise both be told they
    hydrated it, and the second would skip its write.
    """
    # Imported here, not at module scope: hydrate reaches into app.sheets for a
    # Google client, and app.sheets writes call back into this module.
    from app.db.hydrate import hydrate_sync

    with _ready_guard:
        if sheet_id in _ready:
            return False
        built_now = not mirror_exists(sheet_id)
        hydrate_sync(access_token, sheet_id)
        _ready.add(sheet_id)
        return built_now


def forget(sheet_id: str) -> None:
    """Drop the hydration memo — after a reset, which empties the sheet."""
    with _ready_guard:
        _ready.discard(sheet_id)


def _apply(access_token: str, sheet_id: str, tab: str, work) -> None:
    try:
        if _ensure(access_token, sheet_id):
            # The mirror was just built from the sheet, and the sheet already
            # contains this write — it came first. Applying it again appends a
            # duplicate row.
            return
        conn = connect(sheet_id)
        try:
            work(Repo(conn, spec(tab)))
        finally:
            conn.close()
    except Exception as err:
        # Deliberately swallowed — see the module docstring. Drift is detectable;
        # a failed user write because the mirror hiccuped is not acceptable while
        # the mirror serves nothing.
        log.error("mirror", f"{tab}: local write failed, sheet is unaffected", err,
                  {"sheetId": sheet_id})


def append(access_token: str, sheet_id: str, tab: str, records: list[dict]) -> None:
    if not records:
        return
    _apply(access_token, sheet_id, tab, lambda repo: repo.insert_many(records))


def update(access_token: str, sheet_id: str, tab: str, fields: dict, **key) -> None:
    if not fields:
        return

    def work(repo: Repo):
        # A miss means the mirror does not have the row the sheet just updated,
        # which is drift worth naming rather than passing over in silence.
        if repo.update(fields, **key) == 0:
            log.warn("mirror", f"{tab}: no local row for {key}", {"sheetId": sheet_id})

    _apply(access_token, sheet_id, tab, work)


def update_row(access_token: str, sheet_id: str, tab: str,
               sheet_row: int, fields: dict) -> None:
    """For callers that addressed the sheet by row number rather than by key."""
    if not fields:
        return
    _apply(access_token, sheet_id, tab,
           lambda repo: repo.update_row(sheet_row, fields))


def blank_row(access_token: str, sheet_id: str, tab: str, sheet_row: int) -> None:
    """Clear every column, matching a sheet write of empty strings. Categories
    are removed this way — the row stays, so positions never shift."""
    s = spec(tab)
    update_row(access_token, sheet_id, tab, sheet_row, {c: "" for c in s.columns})

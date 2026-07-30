"""The local mirror: every read, and the local half of every write.

Phase 3. Reads are served from here; writes still go to the sheet as well, so
the two stores stay identical and the syncer can take over in 3b.

`rows()` returns positional lists in sheet order — the exact shape
values().get returns. That is deliberate: every sheets module already parses
that shape, so moving a read off the API is a one-line change and nothing
downstream has to be rewritten or retested.

**Failures here are raised, not swallowed.** They were swallowed in phase 2,
when the mirror served nothing and drift was merely detectable. Now that reads
come from here, a missed write means the user is shown data that is missing
their last change. Failing loudly is the honest outcome, and the row is still
safe in the sheet.

**Write functions must be called AFTER the sheet write has succeeded.** That
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


def rows(access_token: str, sheet_id: str, tab: str) -> list[list[str]]:
    """Every row, positionally, in sheet order — the shape values().get returns.

    Index i is sheet row i + 2, so callers that used to compute a row number
    from a list position keep working unchanged.
    """
    _ensure(access_token, sheet_id)
    conn = connect(sheet_id)
    try:
        s = spec(tab)
        return [s.to_row(r) for r in Repo(conn, s).all()]
    finally:
        conn.close()


def records(access_token: str, sheet_id: str, tab: str) -> list[dict]:
    """Rows as column-keyed dicts, each carrying its sheet row as _row."""
    _ensure(access_token, sheet_id)
    conn = connect(sheet_id)
    try:
        return Repo(conn, spec(tab)).all()
    finally:
        conn.close()


def append(access_token: str, sheet_id: str, tab: str, records: list[dict]) -> None:
    if not records:
        return
    _apply(access_token, sheet_id, tab, lambda repo: repo.insert_many(records))


def update(access_token: str, sheet_id: str, tab: str, fields: dict, **key) -> None:
    if not fields:
        return

    def work(repo: Repo):
        # A miss means the mirror lacks the row the sheet just updated. Since
        # the mirror now serves reads, that is a user-visible discrepancy.
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

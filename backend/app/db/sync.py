"""The syncer: local changes out to the sheet.

This is the half of the migration the whole thing was for. Writes now land in
SQLite and return; the sheet is caught up here, on an interval, in a handful of
requests. A fifty-order email import used to be fifty appends and fifty row
lookups against a 60-per-minute quota; it is now one batched write.

Three properties make it safe to run unattended:

  It claims by high-water mark. The outbox is append-only and its rowid is the
  sequence, so a write that lands mid-push gets a rowid above the claim and is
  still queued afterwards. Nothing is deleted that was not pushed.

  It is idempotent. Every push writes whole rows at their own addresses, so
  re-running after a crash or a 429 rewrites the same cells with the same
  values. That is why a failure can simply leave the queue alone and retry.

  It never shrinks the sheet. Rows are only appended and soft-deleted, so a
  push is updates to rows the sheet already has plus appends past the end. No
  code path here clears or deletes a row.
"""
import asyncio

from app.core.dates import now_iso
from app.core.logger import log
from app.db.connection import connect, known_mirrors, mirror_exists
from app.db.registry import TABS, TabSpec
from app.db.repo import Repo
from app.sheets.client import get_sheets_client, with_sheets_retry
from app.sheets.migrations import (
    ensure_date_column_format_sync,
    ensure_item_suggestions_tab_sync,
    ensure_parsed_emails_tab_sync,
    ensure_transaction_schema_sync,
)

# Sheets bills per request, so a run of adjacent rows travels as one ValueRange.
# The cap only stops a first push of a very large sheet from building a single
# enormous body; a normal push is far below it.
MAX_ROWS_PER_BLOCK = 1000


def _runs(row_nums: list[int]) -> list[tuple[int, int]]:
    """Sorted row numbers -> contiguous [first, last] spans.

    Fifty rows appended together are fifty adjacent numbers, and writing them
    as one range instead of fifty is the difference between one request and
    fifty.
    """
    spans: list[tuple[int, int]] = []
    for n in sorted(set(row_nums)):
        if spans and n == spans[-1][1] + 1:
            spans[-1] = (spans[-1][0], n)
        else:
            spans.append((n, n))
    return spans


def _claim(conn, tab: str) -> tuple[int | None, list[int]]:
    """Everything queued for this tab right now, and the mark to delete up to.

    Rows queued after this call get a higher rowid, so they survive the delete
    and are pushed on the next tick.
    """
    high = conn.execute(
        "SELECT MAX(rowid) FROM _outbox WHERE tab = ?", (tab,)).fetchone()[0]
    if high is None:
        return None, []
    rows = conn.execute(
        "SELECT DISTINCT row_num FROM _outbox WHERE tab = ? AND rowid <= ? "
        "ORDER BY row_num", (tab, high)).fetchall()
    return high, [r[0] for r in rows]


def _last_row_pushed(conn, tab: str) -> int:
    row = conn.execute(
        "SELECT last_row_pushed FROM _sync WHERE tab = ?", (tab,)).fetchone()
    return row[0] if row else 1     # 1 = header only, no data rows in the sheet


def _values(repo: Repo, spec: TabSpec, first: int, last: int) -> list[list[str]]:
    """The rows currently occupying sheet rows first..last, in order."""
    rows = repo.where("rowid BETWEEN ? AND ?", (first - 1, last - 1))
    return [spec.to_row(r) for r in rows]


# How many rows each tab's grid holds, per process. Read once and then tracked
# through our own growth, because only the syncer adds rows.
_grid_rows: dict[tuple[str, str], int] = {}


def _grid_capacity(sheets, sheet_id: str, spec: TabSpec) -> tuple[int | None, int]:
    """(tab id, row count) for a tab, or (None, 0) if it does not exist yet."""
    res = with_sheets_retry(lambda: sheets.spreadsheets().get(
        spreadsheetId=sheet_id,
        fields="sheets(properties(sheetId,title,gridProperties(rowCount)))",
    ).execute())
    for sheet in res.get("sheets") or []:
        props = sheet.get("properties") or {}
        if props.get("title") == spec.name:
            rows = (props.get("gridProperties") or {}).get("rowCount") or 0
            return props.get("sheetId"), rows
    return None, 0


def _ensure_capacity(sheets, sheet_id: str, spec: TabSpec, needed: int) -> int:
    """Make sure the tab has at least `needed` rows. Returns requests made.

    Addressing rows exactly is what makes a push idempotent, and values().update
    refuses a range past the grid — a new spreadsheet stops at 1000 rows. The
    obvious alternative, values().append, positions itself after the last row
    holding data, which is not the same as the last row the mirror knows about:
    blanking the last category row would move the landing spot up one and put
    the two stores permanently out of step.
    """
    key = (sheet_id, spec.name)
    if _grid_rows.get(key, 0) >= needed:
        return 0

    gid, rows = _grid_capacity(sheets, sheet_id, spec)
    _grid_rows[key] = rows
    if rows >= needed or gid is None:
        return 1

    # Grow with room to spare, so an import does not pay for this per batch.
    extra = max(needed - rows, 1000)
    with_sheets_retry(lambda: sheets.spreadsheets().batchUpdate(
        spreadsheetId=sheet_id,
        body={"requests": [{"appendDimension": {
            "sheetId": gid, "dimension": "ROWS", "length": extra}}]},
    ).execute())
    _grid_rows[key] = rows + extra
    return 2


def _write_rows(sheets, sheet_id: str, spec: TabSpec,
                spans: list[tuple[int, int]], repo: Repo) -> int:
    """Write whole rows at their own addresses. Returns requests made.

    Whole rows, not changed cells: it is what makes a push idempotent, so a
    retry after a 429 rewrites the same values rather than having to work out
    what the previous attempt managed to send.
    """
    requests = 0
    for batch in _batches(spec, spans, repo):
        with_sheets_retry(lambda b=batch: sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=sheet_id,
            body={"valueInputOption": "RAW", "data": b},
        ).execute())
        requests += 1
        requests += _write_user_entered(
            sheets, sheet_id, spec,
            [(_first_row_of(d["range"]), d["values"]) for d in batch])
    return requests


def _batches(spec: TabSpec, spans: list[tuple[int, int]],
             repo: Repo) -> list[list[dict]]:
    """Spans -> ValueRanges, grouped so no single request carries too many rows.

    The cap is on the request, not just on each range: a first push of a large
    sheet would otherwise put every block in one body. It never bites a normal
    push, which is a handful of rows.
    """
    batches: list[list[dict]] = []
    current: list[dict] = []
    rows_in_current = 0

    for first, last in spans:
        row = first
        while row <= last:
            stop = min(row + MAX_ROWS_PER_BLOCK - 1, last)
            values = _values(repo, spec, row, stop)
            if values:
                if rows_in_current and rows_in_current + len(values) > MAX_ROWS_PER_BLOCK:
                    batches.append(current)
                    current, rows_in_current = [], 0
                current.append({
                    "range": spec.block_range(row, row + len(values) - 1),
                    "values": values})
                rows_in_current += len(values)
            row = stop + 1

    if current:
        batches.append(current)
    return batches


def _write_user_entered(sheets, sheet_id: str, spec: TabSpec,
                        blocks: list[tuple[int, list[list[str]]]]) -> int:
    """Re-write the interpreted columns on their own, given (first row, rows).

    Splitting the write is not a nicety: valueInputOption is per request, so
    USER_ENTERED on a whole row would evaluate a merchant like "=Zomato" as a
    formula and reformat every ISO timestamp on the row.
    """
    if not spec.user_entered:
        return 0

    cells = []
    for first, rows in blocks:
        for column in spec.user_entered:
            i = spec.columns.index(column)
            cells.append({
                "range": spec.column_range(column, first, first + len(rows) - 1),
                "values": [[r[i]] for r in rows],
            })
    if not cells:
        return 0
    with_sheets_retry(lambda: sheets.spreadsheets().values().batchUpdate(
        spreadsheetId=sheet_id,
        body={"valueInputOption": "USER_ENTERED", "data": cells},
    ).execute())
    return 1


def _first_row_of(range_: str) -> int:
    start = range_.split("!", 1)[1].split(":")[0]
    return int("".join(c for c in start if c.isdigit()))


def _push_tab(conn, sheets, sheet_id: str, spec: TabSpec) -> dict | None:
    high, queued = _claim(conn, spec.name)
    last_pushed = _last_row_pushed(conn, spec.name)
    repo = Repo(conn, spec)
    local_last = repo.count() + 1        # sheet row of the last local row

    # Rows past the end of the sheet have to go out whether or not the queue
    # still lists them — that is what makes a half-finished previous push
    # recoverable rather than a permanent gap.
    rows_to_write = [n for n in queued if n <= last_pushed]
    rows_to_write += list(range(last_pushed + 1, local_last + 1))
    if not rows_to_write:
        if high is not None:
            conn.execute("DELETE FROM _outbox WHERE tab = ? AND rowid <= ?",
                         (spec.name, high))
        return None

    spans = _runs(rows_to_write)
    requests = _ensure_capacity(sheets, sheet_id, spec, local_last)
    try:
        requests += _write_rows(sheets, sheet_id, spec, spans, repo)
    except Exception as err:
        if "grid limits" not in str(err):
            raise
        # The memo was stale — the tab was reset, or replaced. Re-read the real
        # capacity and try once more, so this heals instead of stalling here
        # every minute.
        _grid_rows.pop((sheet_id, spec.name), None)
        requests += _ensure_capacity(sheets, sheet_id, spec, local_last)
        requests += _write_rows(sheets, sheet_id, spec, spans, repo)

    if high is not None:
        conn.execute("DELETE FROM _outbox WHERE tab = ? AND rowid <= ?",
                     (spec.name, high))
    conn.execute(
        "INSERT INTO _sync(tab, last_push_at, last_row_pushed, last_error) "
        "VALUES (?, ?, ?, NULL) ON CONFLICT(tab) DO UPDATE SET "
        "last_push_at = excluded.last_push_at, "
        "last_row_pushed = excluded.last_row_pushed, last_error = NULL",
        (spec.name, now_iso(), max(local_last, last_pushed)),
    )
    return {"rows": len(rows_to_write), "requests": requests}


def _record_failure(conn, tab: str, err: Exception) -> None:
    """Leave the queue alone — the next tick retries it. Only say what broke."""
    conn.execute(
        "INSERT INTO _sync(tab, last_error) VALUES (?, ?) "
        "ON CONFLICT(tab) DO UPDATE SET last_error = excluded.last_error",
        (tab, str(err)[:500]),
    )


def _ensure_sheet_schema(sheets, sheet_id: str) -> None:
    """The syncer is the only writer of data rows, so it owns keeping the sheet
    able to receive them — a missing tab or a short header row.

    This used to run on every append, from the append path. Each check memoises
    per process, so it now costs a couple of requests per restart instead.
    """
    for check in (ensure_transaction_schema_sync, ensure_parsed_emails_tab_sync,
                  ensure_item_suggestions_tab_sync, ensure_date_column_format_sync):
        try:
            check(sheets, sheet_id)
        except Exception as err:
            # A push with an out-of-date header still writes the right cells;
            # they would just sit under a blank heading.
            log.warn("sync", f"schema check failed: {check.__name__}",
                     {"error": str(err)[:200]})


def forget_sheet(sheet_id: str) -> None:
    """Drop what we believe about a sheet's grid — after a reset, which can
    replace the tabs entirely."""
    for key in [k for k in _grid_rows if k[0] == sheet_id]:
        _grid_rows.pop(key, None)


def pending_count(sheet_id: str) -> int:
    """How many queued row-writes are waiting. 0 without opening a connection
    when there is no mirror at all."""
    if not mirror_exists(sheet_id):
        return 0
    conn = connect(sheet_id)
    try:
        return conn.execute("SELECT COUNT(*) FROM _outbox").fetchone()[0]
    finally:
        conn.close()


def push_sync(access_token: str, sheet_id: str) -> dict:
    """Push every tab with queued changes. Per-tab failures are isolated."""
    if not mirror_exists(sheet_id):
        return {}

    sheets = get_sheets_client(access_token)
    _ensure_sheet_schema(sheets, sheet_id)
    conn = connect(sheet_id)
    pushed: dict[str, dict] = {}
    try:
        for spec in TABS:
            try:
                result = _push_tab(conn, sheets, sheet_id, spec)
            except Exception as err:
                # One tab's quota error must not strand the other five.
                _record_failure(conn, spec.name, err)
                log.error("sync", f"{spec.name}: push failed", err,
                          {"sheetId": sheet_id})
                continue
            if result:
                pushed[spec.name] = result
    finally:
        conn.close()

    if pushed:
        log.info("sync", "pushed to sheet", {"sheetId": sheet_id[:8], **{
            t: r["rows"] for t, r in pushed.items()}})
    return pushed


async def push(access_token: str, sheet_id: str) -> dict:
    return await asyncio.to_thread(push_sync, access_token, sheet_id)


def sheets_with_pending() -> list[str]:
    """Every mirror on disk holding unpushed changes.

    Enumerating the disk rather than a list of logged-in users is deliberate:
    after a restart nobody is logged in, and the changes still have to go out.
    """
    return [sid for sid in known_mirrors() if pending_count(sid)]

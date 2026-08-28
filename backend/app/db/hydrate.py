"""Filling an empty mirror from the sheet.

This is the bootstrap path — a rebuilt VPS, a lost disk, and the first deploy of
this change, which is where every existing user starts. It is the one direction
data ever flows from the sheet into the database, and it runs once per tab.

Two rules make the result trustworthy:

  Insert verbatim, in sheet order, skipping nothing. Row position is row
  identity, so a skipped blank row shifts every row below it onto the wrong
  sheet line.

  Verify before trusting. Count and a checksum of the key column, per tab. On
  mismatch the file is deleted and the failure is loud — a half-populated
  mirror that looks fine is far worse than no mirror, because the syncer would
  push it back over the sheet.
"""
import asyncio
import hashlib
import threading

from googleapiclient.errors import HttpError

from app.core.logger import log
from app.db.connection import connect, discard_mirror, mirror_exists
from app.db.registry import TABS, TabSpec
from app.db.repo import Repo
from app.sheets.client import get_sheets_client, with_sheets_retry

# Hydration creates the file, so two concurrent first-requests would otherwise
# both run it and double every row. Single worker, so an in-process lock is
# enough.
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(sheet_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(sheet_id, threading.Lock())


def _checksum(rows: list[list[str]], spec: TabSpec) -> str:
    """Fingerprint of the key columns, in order. Catches a shifted or dropped
    row, which a bare count would not."""
    idx = [spec.columns.index(c) for c in spec.key]
    joined = "\n".join(
        "\x1f".join(r[i] if i < len(r) else "" for i in idx) for r in rows
    )
    return hashlib.sha256(joined.encode()).hexdigest()


def _normalise(row: list, width: int) -> list[str]:
    """Sheets truncates trailing empty cells and returns [] for a blank row.
    Pad rather than skip: the row still occupies its line in the sheet."""
    out = ["" if c is None else str(c) for c in row[:width]]
    return out + [""] * (width - len(out))


def _read_tab(sheets, sheet_id: str, spec: TabSpec) -> list[list[str]]:
    try:
        res = with_sheets_retry(lambda: sheets.spreadsheets().values().get(
            spreadsheetId=sheet_id, range=spec.data_range
        ).execute())
    except HttpError as err:
        msg = str(err)
        if "Unable to parse range" in msg or "not found" in msg:
            return []          # tab does not exist yet — nothing to copy
        raise
    return [_normalise(r, len(spec.columns)) for r in (res.get("values") or [])]


def _hydrate_tab(conn, sheets, sheet_id: str, spec: TabSpec) -> int:
    repo = Repo(conn, spec)

    already = conn.execute(
        "SELECT hydrated_at FROM _sync WHERE tab = ?", (spec.name,)).fetchone()
    if already and already["hydrated_at"]:
        return repo.count()

    if repo.count():
        # Refusing rather than merging: this can only mean local writes have
        # already happened, and copying the sheet over them would duplicate
        # every row.
        raise RuntimeError(
            f"{spec.name} already holds {repo.count()} rows — refusing to hydrate")

    rows = _read_tab(sheets, sheet_id, spec)
    repo.insert_rows(rows)

    stored = repo.all()
    if len(stored) != len(rows):
        raise RuntimeError(
            f"{spec.name}: wrote {len(stored)} rows, read {len(rows)}")
    if _checksum([spec.to_row(r) for r in stored], spec) != _checksum(rows, spec):
        raise RuntimeError(f"{spec.name}: checksum mismatch after hydration")

    # These rows came FROM the sheet, so they are not pending changes. The
    # inserts queued them in the outbox, and leaving them there would make the
    # first push rewrite the whole sheet with what it already contains.
    conn.execute("DELETE FROM _outbox WHERE tab = ?", (spec.name,))
    conn.execute(
        "INSERT INTO _sync(tab, hydrated_at, last_row_pushed) "
        "VALUES (?, datetime('now'), ?) "
        "ON CONFLICT(tab) DO UPDATE SET hydrated_at = excluded.hydrated_at, "
        "last_row_pushed = excluded.last_row_pushed",
        (spec.name, len(rows) + 1),
    )
    return len(rows)


def hydrate_sync(access_token: str, sheet_id: str) -> dict[str, int]:
    """Create the mirror and fill every tab from the sheet. Idempotent."""
    with _lock_for(sheet_id):
        if mirror_exists(sheet_id):
            conn = connect(sheet_id)
            try:
                return {s.name: Repo(conn, s).count() for s in TABS}
            finally:
                conn.close()

        log.info("db", "no local mirror — hydrating from the sheet",
                 {"sheetId": sheet_id})
        sheets = get_sheets_client(access_token)
        conn = connect(sheet_id)
        try:
            counts = {}
            for spec in TABS:
                counts[spec.name] = _hydrate_tab(conn, sheets, sheet_id, spec)
            log.info("db", "hydrated", counts)
            return counts
        except Exception:
            # A half-populated mirror is worse than none: the syncer would push
            # it back over the sheet. Leave nothing behind to be trusted.
            conn.close()
            discard_mirror(sheet_id)
            log.error("db", "hydration failed — mirror discarded",
                      None, {"sheetId": sheet_id})
            raise
        finally:
            try:
                conn.close()
            except Exception:
                pass


async def ensure_hydrated(access_token: str, sheet_id: str) -> dict[str, int]:
    return await asyncio.to_thread(hydrate_sync, access_token, sheet_id)

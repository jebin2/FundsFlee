"""parsed_emails tab — port of src/lib/sheets/parsedEmails.ts.

Columns: email_id | from | subject | parsed_at | status | tx_ids | attempts
status: "parsed" | "partial" | "skipped" | "failed" | "failed_permanent"
tx_ids: comma-separated transaction IDs (empty for skipped/failed)
attempts: how many times the import has tried this message
"""
import asyncio
from typing import TypedDict

from googleapiclient.errors import HttpError

from app.sheets.client import get_sheets_client, with_sheets_retry
from app.sheets.migrations import ensure_parsed_emails_tab_sync

RANGE = "parsed_emails!A2:G"
COLS = {"email_id": 0, "from": 1, "subject": 2, "parsed_at": 3, "status": 4,
        "tx_ids": 5, "attempts": 6}
LAST_COL = "G"

# Statuses the import will look at again on the next run. A failure means the
# AI chain was unreachable or returned nothing usable — a transient condition —
# and treating it as final meant one bad minute lost that email permanently,
# with the only recovery being to delete its row from the sheet by hand.
#
# "parsed", "partial" and "skipped" are real verdicts and stay terminal. Note
# that retrying is only safe because a message reaching "failed" wrote no rows;
# see the partial-failure handling in the import job.
RETRYABLE_STATUSES = {"failed"}

# After this many attempts a message stops coming back. Without it a permanently
# broken provider turns every run into a re-run of the same doomed backlog, at
# full parse cost per message.
MAX_ATTEMPTS = 3
EXHAUSTED_STATUS = "failed_permanent"


class EmailState(TypedDict):
    status: str
    attempts: int


class ParsedEmailRecord(TypedDict):
    emailId: str
    from_: str
    subject: str
    parsedAt: str
    status: str
    txIds: list[str]
    attempts: int


# email_id -> sheet row number, per sheet. Seeded by get_email_states and kept
# current by record_parsed_email, so a run does one read instead of one per
# message. Mirrors _row_index_cache in transactions.py.
_index_cache: dict[str, dict[str, int]] = {}


def invalidate_index(sheet_id: str) -> None:
    _index_cache.pop(sheet_id, None)


def _at(r: list, i: int) -> str:
    return r[i] if i < len(r) and r[i] is not None else ""


def _int_at(r: list, i: int) -> int:
    try:
        return int(_at(r, i) or 0)
    except ValueError:
        return 0


def _get_all_rows_sync(sheets, sheet_id: str) -> list[list]:
    """Every recorded row, or a raise.

    This used to swallow ANY exception and return [] as though the tab were
    missing. An empty result here does not mean "nothing processed yet" to the
    callers — it means "process everything again", so a single 429 would
    reimport the whole backlog and duplicate every transaction in it. Only a
    genuinely absent tab is handled; everything else propagates.
    """
    try:
        return with_sheets_retry(lambda: sheets.spreadsheets().values().get(
            spreadsheetId=sheet_id, range=RANGE
        ).execute()).get("values") or []
    except HttpError as err:
        msg = str(err)
        if "Unable to parse range" in msg or "not found" in msg:
            # Tab missing for users whose sheet predates this feature — create it
            ensure_parsed_emails_tab_sync(sheets, sheet_id)
            return []
        raise


def _index_from_rows(rows: list[list]) -> dict[str, int]:
    return {
        _at(r, COLS["email_id"]): i + 2   # +2: 1-indexed plus the header row
        for i, r in enumerate(rows) if _at(r, COLS["email_id"])
    }


# Load ALL recorded state — call ONCE per job run, then check in memory instead
# of hitting the Sheets API per email. Also seeds the row-index cache.
async def get_email_states(access_token: str, sheet_id: str) -> dict[str, EmailState]:
    def work():
        sheets = get_sheets_client(access_token)
        rows = _get_all_rows_sync(sheets, sheet_id)
        _index_cache[sheet_id] = _index_from_rows(rows)
        return {
            _at(r, COLS["email_id"]): EmailState(
                status=_at(r, COLS["status"]),
                attempts=_int_at(r, COLS["attempts"]),
            )
            for r in rows if _at(r, COLS["email_id"])
        }
    return await asyncio.to_thread(work)


# Ids the import should not look at again.
async def get_processed_email_ids(access_token: str, sheet_id: str) -> set[str]:
    states = await get_email_states(access_token, sheet_id)
    return {mid for mid, st in states.items()
            if st["status"] not in RETRYABLE_STATUSES}


# Returns True if this email has already been processed (any status).
# Prefer get_processed_email_ids() in loops to avoid N+1 Sheets API calls.
async def check_email_parsed(access_token: str, sheet_id: str, email_id: str) -> bool:
    def work():
        sheets = get_sheets_client(access_token)
        rows = _get_all_rows_sync(sheets, sheet_id)
        return any(_at(r, COLS["email_id"]) == email_id for r in rows)
    return await asyncio.to_thread(work)


def _row_number_of(sheets, sheet_id: str, email_id: str) -> int | None:
    index = _index_cache.get(sheet_id)
    if index is None:
        rows = _get_all_rows_sync(sheets, sheet_id)
        index = _index_cache[sheet_id] = _index_from_rows(rows)
    return index.get(email_id)


def _appended_row_number(response: dict) -> int | None:
    """Row the append actually landed on, from updatedRange like
    "parsed_emails!A57:G57". Trusting a local counter instead would corrupt the
    index if anything else ever wrote to the tab."""
    rng = ((response or {}).get("updates") or {}).get("updatedRange") or ""
    tail = rng.split("!")[-1]
    digits = "".join(c for c in tail.split(":")[0] if c.isdigit())
    return int(digits) if digits else None


# Write a processing result for one email.
async def record_parsed_email(access_token: str, sheet_id: str, record: dict) -> None:
    def work():
        sheets = get_sheets_client(access_token)
        row = [
            record["emailId"],
            record["from"][:100],
            record["subject"][:150],
            record["parsedAt"],
            record["status"],
            ",".join(record["txIds"]),
            str(record.get("attempts", 1)),
        ]

        # Upsert, because a failed email is retried on the next run: appending
        # would leave a second row for the same message and quietly inflate the
        # scanned/failed counts in settings.
        existing_row = _row_number_of(sheets, sheet_id, record["emailId"])
        if existing_row is not None:
            with_sheets_retry(lambda: sheets.spreadsheets().values().update(
                spreadsheetId=sheet_id,
                range=f"parsed_emails!A{existing_row}:{LAST_COL}{existing_row}",
                valueInputOption="RAW",
                body={"values": [row]},
            ).execute())
            return

        res = with_sheets_retry(lambda: sheets.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range="parsed_emails!A2",
            valueInputOption="RAW",
            body={"values": [row]},
        ).execute())

        landed = _appended_row_number(res)
        if landed is not None:
            _index_cache.setdefault(sheet_id, {})[record["emailId"]] = landed
        else:
            # Could not tell where it went — drop the cache rather than let it
            # drift and overwrite the wrong row later.
            invalidate_index(sheet_id)
    await asyncio.to_thread(work)


# Returns stats for the status display in settings.
async def get_parsed_email_stats(access_token: str, sheet_id: str) -> dict:
    def work():
        sheets = get_sheets_client(access_token)
        rows = _get_all_rows_sync(sheets, sheet_id)
        status_at = COLS["status"]
        return {
            "total": len(rows),
            "parsed": sum(1 for r in rows if _at(r, status_at) == "parsed"),
            "partial": sum(1 for r in rows if _at(r, status_at) == "partial"),
            "skipped": sum(1 for r in rows if _at(r, status_at) == "skipped"),
            "failed": sum(1 for r in rows if _at(r, status_at) == "failed"),
            "failedPermanent": sum(1 for r in rows
                                   if _at(r, status_at) == EXHAUSTED_STATUS),
        }
    return await asyncio.to_thread(work)

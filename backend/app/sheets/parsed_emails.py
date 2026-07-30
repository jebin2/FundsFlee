"""parsed_emails tab — port of src/lib/sheets/parsedEmails.ts.

Columns: email_id | from | subject | parsed_at | status | tx_ids
status: "parsed" | "partial" | "skipped" | "failed"
tx_ids: comma-separated transaction IDs (empty for skipped/failed)
"""
import asyncio
from typing import TypedDict

from googleapiclient.errors import HttpError

from app.sheets.client import get_sheets_client, with_sheets_retry
from app.sheets.migrations import ensure_parsed_emails_tab_sync

RANGE = "parsed_emails!A2:F"
COLS = {"email_id": 0, "from": 1, "subject": 2, "parsed_at": 3, "status": 4, "tx_ids": 5}


class ParsedEmailRecord(TypedDict):
    emailId: str
    from_: str
    subject: str
    parsedAt: str
    status: str  # parsed | skipped | failed
    txIds: list[str]


def _at(r: list, i: int) -> str:
    return r[i] if i < len(r) and r[i] is not None else ""


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


# Statuses the import will look at again on the next run. A failure means the
# AI chain was unreachable or returned nothing usable — a transient condition —
# and treating it as final meant one bad minute lost that email permanently,
# with the only recovery being to delete its row from the sheet by hand.
#
# "parsed", "partial" and "skipped" are real verdicts and stay terminal. Note
# that retrying is only safe because a message reaching "failed" wrote no rows;
# see the partial-failure handling in the import job.
RETRYABLE_STATUSES = {"failed"}


# Load ALL recorded email statuses — call ONCE per job run, then check in
# memory instead of hitting the Sheets API per email.
async def get_email_statuses(access_token: str, sheet_id: str) -> dict[str, str]:
    def work():
        sheets = get_sheets_client(access_token)
        rows = _get_all_rows_sync(sheets, sheet_id)
        return {
            _at(r, COLS["email_id"]): _at(r, COLS["status"])
            for r in rows if _at(r, COLS["email_id"])
        }
    return await asyncio.to_thread(work)


# Ids the import should not look at again.
async def get_processed_email_ids(access_token: str, sheet_id: str) -> set[str]:
    statuses = await get_email_statuses(access_token, sheet_id)
    return {mid for mid, st in statuses.items() if st not in RETRYABLE_STATUSES}


# Returns True if this email has already been processed (any status).
# Prefer get_processed_email_ids() in loops to avoid N+1 Sheets API calls.
async def check_email_parsed(access_token: str, sheet_id: str, email_id: str) -> bool:
    def work():
        sheets = get_sheets_client(access_token)
        rows = _get_all_rows_sync(sheets, sheet_id)
        return any(_at(r, COLS["email_id"]) == email_id for r in rows)
    return await asyncio.to_thread(work)


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
        ]

        # Upsert, because a failed email is retried on the next run: appending
        # would leave a second row for the same message and quietly inflate the
        # scanned/failed counts in settings.
        existing = _get_all_rows_sync(sheets, sheet_id)
        for i, r in enumerate(existing):
            if _at(r, COLS["email_id"]) == record["emailId"]:
                with_sheets_retry(lambda n=i + 2: sheets.spreadsheets().values().update(
                    spreadsheetId=sheet_id,
                    range=f"parsed_emails!A{n}:F{n}",
                    valueInputOption="RAW",
                    body={"values": [row]},
                ).execute())
                return

        with_sheets_retry(lambda: sheets.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range="parsed_emails!A2",
            valueInputOption="RAW",
            body={"values": [row]},
        ).execute())
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
        }
    return await asyncio.to_thread(work)

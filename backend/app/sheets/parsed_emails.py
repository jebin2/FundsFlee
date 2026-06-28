"""parsed_emails tab — port of src/lib/sheets/parsedEmails.ts.

Columns: email_id | from | subject | parsed_at | status | tx_ids
status: "parsed" | "skipped" | "failed"
tx_ids: comma-separated transaction IDs (empty for skipped/failed)
"""
import asyncio
from typing import TypedDict

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
    try:
        res = sheets.spreadsheets().values().get(
            spreadsheetId=sheet_id, range=RANGE
        ).execute()
        return res.get("values") or []
    except Exception:
        # Tab missing for users whose sheet predates this feature — create it
        try:
            ensure_parsed_emails_tab_sync(sheets, sheet_id)
        except Exception:
            pass
        return []


# Load ALL processed email IDs into a set — call ONCE per job run,
# then check membership in memory instead of hitting the Sheets API per email.
async def get_processed_email_ids(access_token: str, sheet_id: str) -> set[str]:
    def work():
        sheets = get_sheets_client(access_token)
        rows = _get_all_rows_sync(sheets, sheet_id)
        return {_at(r, COLS["email_id"]) for r in rows if _at(r, COLS["email_id"])}
    return await asyncio.to_thread(work)


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
            "skipped": sum(1 for r in rows if _at(r, status_at) == "skipped"),
            "failed": sum(1 for r in rows if _at(r, status_at) == "failed"),
        }
    return await asyncio.to_thread(work)

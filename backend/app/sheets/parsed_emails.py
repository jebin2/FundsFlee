"""parsed_emails tab — port of src/lib/sheets/parsedEmails.ts.

Columns: email_id | from | subject | parsed_at | status | tx_ids | attempts
status: "parsed" | "partial" | "skipped" | "failed" | "failed_permanent"
tx_ids: comma-separated transaction IDs (empty for skipped/failed)
attempts: how many times the import has tried this message
"""
import asyncio
from typing import TypedDict

from app.db import mirror
from app.db.repo import ROW_FIELD
from app.db.registry import PARSED_EMAILS_HEADERS

COLS = {"email_id": 0, "from": 1, "subject": 2, "parsed_at": 3, "status": 4,
        "tx_ids": 5, "attempts": 6}

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


def _at(r: list, i: int) -> str:
    return r[i] if i < len(r) and r[i] is not None else ""


def _int_at(r: list, i: int) -> int:
    try:
        return int(_at(r, i) or 0)
    except ValueError:
        return 0


def _get_all_rows_sync(access_token: str, sheet_id: str) -> list[list]:
    """Every recorded row, or a raise.

    Local now, which also settles an old hazard: this used to swallow ANY
    exception and return [] as though the tab were missing. An empty result
    does not mean "nothing processed yet" to the callers — it means "process
    everything again", so one 429 would reimport the whole backlog and
    duplicate every transaction in it. A local read either succeeds or raises;
    there is no ambiguous empty.
    """
    return mirror.rows(access_token, sheet_id, "parsed_emails")


# Load ALL recorded state — call ONCE per job run, then check in memory instead
# of hitting the Sheets API per email. Also seeds the row-index cache.
async def get_email_states(access_token: str, sheet_id: str) -> dict[str, EmailState]:
    def work():
        rows = _get_all_rows_sync(access_token, sheet_id)
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
        rows = _get_all_rows_sync(access_token, sheet_id)
        return any(_at(r, COLS["email_id"]) == email_id for r in rows)
    return await asyncio.to_thread(work)


def _row_number_of(access_token: str, sheet_id: str, email_id: str) -> int | None:
    """Indexed, not a scan: this runs once per message, against a tab that
    grows with every message, so a scan here is quadratic over a long import."""
    found = mirror.find(access_token, sheet_id, "parsed_emails", email_id=email_id)
    return found[ROW_FIELD] if found else None


# Write a processing result for one email.
async def record_parsed_email(access_token: str, sheet_id: str, record: dict) -> None:
    def work():
        row = [
            record["emailId"],
            record["from"][:100],
            record["subject"][:150],
            record["parsedAt"],
            record["status"],
            ",".join(record["txIds"]),
            str(record.get("attempts", 1)),
        ]
        fields = dict(zip(PARSED_EMAILS_HEADERS, row))

        # Upsert, because a failed email is retried on the next run: appending
        # would leave a second row for the same message and quietly inflate the
        # scanned/failed counts in settings.
        existing_row = _row_number_of(access_token, sheet_id, record["emailId"])
        if existing_row is not None:
            mirror.update_row(access_token, sheet_id, "parsed_emails",
                              existing_row, fields)
        else:
            mirror.append(access_token, sheet_id, "parsed_emails", [fields])

    await asyncio.to_thread(work)


# Returns stats for the status display in settings.
async def get_parsed_email_stats(access_token: str, sheet_id: str) -> dict:
    def work():
        rows = _get_all_rows_sync(access_token, sheet_id)
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


def _find_email_for_tx_sync(access_token: str, sheet_id: str, tx_id: str) -> dict | None:
    """The recorded email a transaction came from, via its tx_ids list.

    The transaction row itself keeps only "subject | from" in raw_input, so
    this mapping is the only route from a row back to the message that made it.
    """
    for r in _get_all_rows_sync(access_token, sheet_id):
        ids = [i for i in _at(r, COLS["tx_ids"]).split(",") if i]
        if tx_id in ids:
            return {
                "email_id": _at(r, COLS["email_id"]),
                "from": _at(r, COLS["from"]),
                "subject": _at(r, COLS["subject"]),
                "tx_ids": ids,
                "status": _at(r, COLS["status"]),
                "attempts": _int_at(r, COLS["attempts"]),
            }
    return None


async def find_email_for_tx(access_token: str, sheet_id: str, tx_id: str) -> dict | None:
    return await asyncio.to_thread(_find_email_for_tx_sync, access_token, sheet_id, tx_id)

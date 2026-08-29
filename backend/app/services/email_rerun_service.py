"""Re-running a single email.

An email row could not be retried at all: the pipeline only existed inside the
daily import, and the row keeps just "subject | from" in raw_input, never the
body. So a re-run has to go back to Gmail — which is fine, the scope and the
email_id -> tx_ids mapping in parsed_emails were both already there.

Two calls, deliberately: preview() says what would be replaced, rerun() does
it. A mail can hold several payments, so a re-run can discard rows the person
edited by hand, and that is not a thing to do without showing them first.
"""
import asyncio

from app.core.dates import today_iso, now_iso
from app.core.deps import SheetSession
from app.core.logger import log
from app.email_import.config import read_email_import_config
from app.email_import.message import build_rows, fetch_message, parse_message
from app.services.duplicate_scan import deduplicate_new_transactions
from app.sheets import (
    append_transactions,
    get_transaction_by_id,
    record_parsed_email,
    update_transaction_field,
)
from app.sheets.client import get_gmail_client
from app.sheets.parsed_emails import find_email_for_tx


# One re-run per email at a time. The frontend disables its own button, which
# covers a double-tap and nothing else: closing the sheet and clicking again
# from the list, a second tab, or a phone reissuing the POST all start a second
# run. Both would read the same tx_ids, both would append, both would retire
# the originals — two live sets of rows, at double the AI cost. The duplicate
# scan only FLAGS duplicates, so nothing downstream would clean that up.
#
# Single uvicorn worker, so an in-process set is the whole mechanism, as in
# app/db/hydrate.
_in_flight: set[tuple[str, str]] = set()
_in_flight_guard = asyncio.Lock()


class RerunError(Exception):
    """Something the person can read and act on."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


async def _email_of(session: SheetSession, tx_id: str) -> dict:
    tx = await get_transaction_by_id(session.access_token, session.sheet_id, tx_id)
    if not tx:
        raise RerunError("That transaction no longer exists.", 404)
    if tx.get("source") != "email":
        raise RerunError("This transaction did not come from an email.", 400)

    record = await find_email_for_tx(session.access_token, session.sheet_id, tx_id)
    if not record:
        # Rows imported before parsed_emails recorded tx_ids, mostly. There is
        # no way back to the message, and saying so beats a silent failure.
        raise RerunError(
            "The email this came from is no longer linked to it, so it cannot "
            "be re-read. Edit the transaction instead.", 404)
    return record


async def preview(session: SheetSession, tx_id: str) -> dict:
    """What a re-run would replace. Reads only."""
    record = await _email_of(session, tx_id)

    affected = []
    for other_id in record["tx_ids"]:
        row = await get_transaction_by_id(session.access_token, session.sheet_id, other_id)
        if not row:
            continue          # already deleted; nothing to warn about
        affected.append({
            "id": row["id"],
            "merchant": row.get("merchant"),
            "amount": row.get("amount"),
            "date": row.get("date"),
            "status": row.get("status"),
            # A row whose updated_at moved past its created_at has been touched
            # since import — the edit a re-run would discard.
            "edited": bool(row.get("updated_at")
                           and row.get("created_at")
                           and row["updated_at"] != row["created_at"]),
        })

    return {
        "emailId": record["email_id"],
        "subject": record["subject"],
        "from": record["from"],
        "transactions": affected,
        "rerunning": is_rerunning(session.sheet_id, record["email_id"]),
    }


async def rerun(session: SheetSession, tx_id: str) -> dict:
    """Re-read the mail and replace every row it produced.

    At most one at a time per email — a second overlapping run would double the
    mail's transactions rather than replace them.
    """
    record = await _email_of(session, tx_id)
    msg_id = record["email_id"]
    key = (session.sheet_id, msg_id)

    async with _in_flight_guard:
        if key in _in_flight:
            raise RerunError(
                "This email is already being re-read. Give it a moment.", 409)
        _in_flight.add(key)
    try:
        return await _rerun(session, record, tx_id)
    finally:
        async with _in_flight_guard:
            _in_flight.discard(key)


def is_rerunning(sheet_id: str, email_id: str) -> bool:
    return (sheet_id, email_id) in _in_flight


async def _rerun(session: SheetSession, record: dict, tx_id: str) -> dict:
    msg_id = record["email_id"]
    log.info("email-rerun", "started", {"txId": tx_id, "messageId": msg_id})

    # Note what is NOT done here: the rows are not flipped to "processing" for
    # the duration. Every write stamps updated_at, so marking and restoring
    # would leave every row looking edited by hand — which is precisely the
    # signal the confirmation uses to warn about losing an edit. In-flight
    # state is reported by preview() from memory instead, and touches nothing.
    gmail = get_gmail_client(session.access_token)
    try:
        message = await fetch_message(gmail, msg_id)
    except Exception as err:
        # The usual cause is a mail that has since been deleted. Nothing has
        # been touched at this point, so the existing rows stay exactly as they
        # were — which is the right outcome for a re-run that cannot run.
        log.error("email-rerun", "could not fetch the message", err,
                  {"messageId": msg_id})
        raise RerunError(
            "That email could not be read from Gmail — it may have been "
            "deleted. The existing transactions were left unchanged.", 404)

    config = await read_email_import_config(session)
    outcome = await parse_message(gmail, message, config["region"], today_iso(),
                                  with_attachments=config["attachments"])
    now = now_iso()
    rows = build_rows(outcome["parsed_rows"], message["received_time"], now)

    if not rows:
        # Replacing real rows with nothing would be a silent data loss, so the
        # old rows stay and the failure is reported.
        reason = (outcome["skip_reasons"] or ["the AI found no transaction in it"])[0]
        log.warn("email-rerun", "parsed to nothing — keeping the existing rows",
                 {"messageId": msg_id, "reason": reason})
        raise RerunError(
            f"Re-reading that email produced no transaction ({reason}), so "
            "nothing was replaced.", 422)

    # Write first, then retire the old rows. The other order would leave the
    # mail's transactions missing entirely if the append failed.
    await append_transactions(session.access_token, session.sheet_id, rows)
    new_ids = [r["id"] for r in rows]

    replaced = 0
    for old_id in record["tx_ids"]:
        if old_id in new_ids:
            continue
        try:
            await update_transaction_field(
                session.access_token, session.sheet_id, old_id,
                {"deleted": True, "status": "done"})
            replaced += 1
        except Exception as err:
            log.error("email-rerun", "could not retire an old row", err,
                      {"txId": old_id})

    try:
        await record_parsed_email(session.access_token, session.sheet_id, {
            "emailId": msg_id, "from": record["from"], "subject": record["subject"],
            "parsedAt": now, "status": "parsed", "txIds": new_ids,
            "attempts": record["attempts"],
        })
    except Exception as err:
        log.error("email-rerun", "could not update the email record", err,
                  {"messageId": msg_id})

    try:
        await deduplicate_new_transactions(session, new_ids)
    except Exception as err:
        log.error("email-rerun", "duplicate scan failed", err, {"messageId": msg_id})

    log.info("email-rerun", "done",
             {"messageId": msg_id, "replaced": replaced, "written": len(new_ids)})
    return {"ok": True, "replaced": replaced, "written": len(new_ids),
            "transactionIds": new_ids}

"""Email import job — port of src/server/jobs/emailImportJob.ts."""
import asyncio
import time

from app.core.dates import today_iso, now_iso
from app.core.deps import SheetSession
from app.core.logger import log
from app.email_import.config import read_email_import_config
from app.email_import.gmail_query import build_gmail_query
from app.email_import.message import (
    _group_hard_failed,
    build_rows,
    fetch_message,
    parse_message,
)
from app.services.duplicate_scan import deduplicate_new_transactions
from app.sheets import (
    append_transactions,
    get_email_states,
    record_parsed_email,
    set_meta_values,
)
from app.sheets.parsed_emails import (
    EXHAUSTED_STATUS,
    MAX_ATTEMPTS,
    RETRYABLE_STATUSES,
)
from app.sheets.client import get_gmail_client


# The lock only has to look fresher than the five-minute staleness check, so
# refreshing it per message spent two Sheets requests each — enough on a long
# forwarded batch to exhaust the 60-reads-per-minute quota by itself.
LOCK_REFRESH_SECONDS = 60

# Gmail's per-page maximum. Listing is cheap (5 quota units a page); the cost of
# a run is the per-message get, and those are gated by processed_ids.
LIST_PAGE_SIZE = 500

# How many messages one run will FETCH AND PARSE. Enumeration is deliberately
# not capped to this: the ids have to be listed to the end before the oldest
# unprocessed one is known, and truncating the listing would keep the newest N
# — the same page every run, which is the bug this replaced.
MAX_MESSAGES_PER_RUN = 2000

# Safety valve on enumeration alone, in case a query matches an entire mailbox.
# 200 pages of 500 is 100k ids; listing costs 5 quota units a page.
MAX_LIST_PAGES = 200


async def _list_all_message_ids(gmail, query: str) -> list[str]:
    """Every match, newest-first, following nextPageToken.

    maxResults without pagination silently capped a run at one page. Because
    Gmail returns newest-first, that page was the same 100 messages every time
    and the backlog behind it was not slow to reach — it was unreachable.
    """
    ids: list[str] = []
    page_token: str | None = None

    for _ in range(MAX_LIST_PAGES):
        res = await asyncio.to_thread(
            lambda t=page_token: gmail.users().messages().list(
                userId="me", q=query, maxResults=LIST_PAGE_SIZE, pageToken=t
            ).execute()
        )
        ids.extend(m["id"] for m in (res.get("messages") or []) if m.get("id"))
        page_token = res.get("nextPageToken")
        if not page_token:
            return ids

    log.warn("email", f"stopped listing after {MAX_LIST_PAGES} pages",
             {"listed": len(ids)})
    return ids


def _select_pending(message_ids: list[str], processed_ids: set[str]) -> list[str]:
    """Oldest unprocessed first, at most MAX_MESSAGES_PER_RUN of them.

    Gmail lists newest-first, so the backlog is at the END. Two things have to
    happen in this order: reverse, then cap. Capping the newest-first list
    instead — or capping the listing itself — keeps the newest N, which is the
    same set on every run and strands everything older permanently.
    """
    pending = [m for m in reversed(message_ids) if m not in processed_ids]
    return pending[:MAX_MESSAGES_PER_RUN]


def _status_of(states: dict, msg_id: str) -> str:
    return (states.get(msg_id) or {}).get("status", "")


def _attempts_of(states: dict, msg_id: str) -> int:
    """Attempts INCLUDING the one being recorded now."""
    return (states.get(msg_id) or {}).get("attempts", 0) + 1


def _should_retry_empty(reasons: list[str], msg_id: str, states: dict) -> bool:
    """Whether a message that produced NO rows deserves another run.

    Safe to retry only because nothing was written. ai_null is ambiguous here,
    where it is the whole message's verdict rather than one group's: usually the
    model correctly reporting no debit, occasionally it returning something that
    wasn't JSON. One retry distinguishes the two without looping forever on
    every marketing email.
    """
    if any(_group_hard_failed(r) for r in reasons):
        return True
    if "ai_null" in reasons:
        return _status_of(states, msg_id) not in RETRYABLE_STATUSES
    return False


async def _set_meta_safe(session: SheetSession, key: str, value: str) -> None:
    try:
        await set_meta_values(session.access_token, session.sheet_id, {key: value})
    except Exception:
        pass


async def run_email_import_job(session: SheetSession, manual: bool = False) -> dict:
    config = await read_email_import_config(session)

    # Either filter alone is enough — subject-only catches forwarded alerts.
    if len(config["fromContains"]) == 0 and len(config["subjectContains"]) == 0:
        return {"scanned": 0, "imported": 0, "skipped": 0, "failed": 0}

    # read_email_import_config already drops an abandoned lock, so a value here
    # means a run really is in flight.
    if config["runningAt"]:
        log.warn("email", "already running — skipping")
        return {"scanned": 0, "imported": 0, "skipped": 0, "failed": 0}

    await _set_meta_safe(session, "email_import_running_at", now_iso())
    last_lock_refresh = time.monotonic()

    try:
        tag = "manual" if manual else "auto"
        log.info("email", f"started ({tag})",
                 {"filters": ",".join(config["fromContains"]) or "-",
                  "subjects": ",".join(config["subjectContains"]) or "-",
                  "daysBack": config["daysBack"],
                  "attachments": "on" if config["attachments"] else "off"})

        gmail = get_gmail_client(session.access_token)
        query = build_gmail_query(config["fromContains"], config["daysBack"],
                                  None if manual else config["lastRun"],
                                  config["subjectContains"])
        log.info("email", f"gmail query: {query}")

        try:
            message_ids = await _list_all_message_ids(gmail, query)
        except Exception as err:
            log.error("email", "gmail list failed", err)
            return {"scanned": 0, "imported": 0, "skipped": 0, "failed": 0}

        # Abort rather than assume an empty ledger. Defaulting to {} here means
        # every already-imported message looks new, so one failed read would
        # reimport the entire backlog and duplicate every transaction in it.
        try:
            states = await get_email_states(session.access_token, session.sheet_id)
        except Exception as err:
            log.error("email", "could not read parsed_emails — skipping this run "
                               "rather than risk reimporting everything", err)
            return {"scanned": 0, "imported": 0, "skipped": 0, "failed": 0}
        processed_ids = {m for m, st in states.items()
                         if st["status"] not in RETRYABLE_STATUSES}

        pending = _select_pending(message_ids, processed_ids)
        pending_total = sum(1 for m in message_ids if m not in processed_ids)
        capped = pending_total > len(pending)

        log.info("email", f"found {len(message_ids)} emails",
                 {"pending": len(pending), "capped": capped})
        if capped:
            log.warn("email", f"processing {MAX_MESSAGES_PER_RUN} this run — "
                              "the next run continues from where this stops")

        result = {"scanned": 0, "imported": 0, "skipped": 0, "failed": 0}
        new_tx_ids: list[str] = []
        today = today_iso()

        for msg_id in pending:
            result["scanned"] += 1

            # Keep the lock looking alive on a long run, so the daily cron does
            # not treat it as stale and import everything a second time — but at
            # most once a minute, not once per message.
            if time.monotonic() - last_lock_refresh >= LOCK_REFRESH_SECONDS:
                await _set_meta_safe(session, "email_import_running_at", now_iso())
                last_lock_refresh = time.monotonic()

            from_ = ""
            subject = ""
            received_time = "00:00"

            try:
                message = await fetch_message(gmail, msg_id)
                from_ = message["from"]
                subject = message["subject"]
                received_time = message["received_time"]
            except Exception:
                try:
                    await record_parsed_email(session.access_token, session.sheet_id, {
                        "emailId": msg_id, "from": from_, "subject": subject,
                        "parsedAt": now_iso(),
                        "status": "failed" if _attempts_of(states, msg_id) < MAX_ATTEMPTS
                                  else EXHAUSTED_STATUS,
                        "txIds": [], "attempts": _attempts_of(states, msg_id),
                    })
                except Exception:
                    pass
                result["failed"] += 1
                continue

            # Attachments are opt-in. Off, or with nothing attached, this
            # collapses to a single group holding just the body.
            outcome = await parse_message(gmail, message, config["region"], today,
                                          with_attachments=config["attachments"])
            parsed_rows = outcome["parsed_rows"]
            skip_reasons = outcome["skip_reasons"]
            failed_groups = outcome["failed_groups"]

            transactions = [tx for tx, _, _ in parsed_rows]
            skip_reason = skip_reasons[0] if skip_reasons and not transactions else None

            if not transactions:
                # Nothing was written, so retrying the whole message is free of
                # duplicate risk — mark it failed and let the next run redo it.
                attempts = _attempts_of(states, msg_id)
                retry = _should_retry_empty(skip_reasons, msg_id, states)
                # Give up eventually. A provider that stays broken would
                # otherwise make every run a re-run of the same doomed backlog,
                # at full parse cost per message and forever.
                exhausted = retry and attempts >= MAX_ATTEMPTS
                if exhausted:
                    retry = False
                    log.warn("email", f'giving up on "{subject}" after '
                                      f"{attempts} attempts",
                             {"messageId": msg_id, "reason": skip_reason})

                log.info("email", f'skipped "{subject}"',
                         {"reason": skip_reason, "willRetry": retry,
                          "attempts": attempts})
                try:
                    await record_parsed_email(session.access_token, session.sheet_id, {
                        "emailId": msg_id, "from": from_, "subject": subject,
                        "parsedAt": now_iso(),
                        "status": "failed" if retry
                                  else EXHAUSTED_STATUS if exhausted
                                  else "skipped",
                        "txIds": [], "attempts": attempts,
                    })
                except Exception:
                    pass
                if retry:
                    result["failed"] += 1
                else:
                    result["skipped"] += 1
                continue

            now = now_iso()
            rows_to_write = build_rows(parsed_rows, received_time, now)
            msg_tx_ids = [tx["id"] for tx in rows_to_write]
            for transaction, _, _ in parsed_rows:
                log.info("email", f"imported ₹{transaction['amount']} @ {transaction['merchant']}",
                         {"category": transaction["category"], "subject": subject})

            # One request for the whole message, however many rows it produced.
            await append_transactions(session.access_token, session.sheet_id, rows_to_write)
            new_tx_ids.extend(msg_tx_ids)

            # Some groups landed and some errored. Retrying would re-import the
            # ones that worked — and the duplicate scan only FLAGS duplicates,
            # it does not remove them — so this stays terminal and gets logged
            # loudly instead. Previously it recorded a clean "parsed" and the
            # lost alerts left no trace at all.
            partial = failed_groups > 0
            if partial:
                log.error("email", f'partial import of "{subject}" — '
                                   f"{failed_groups} of {outcome['groups']} groups failed and "
                                   "will NOT be retried (rows already written)",
                          None, {"messageId": msg_id, "rows": len(msg_tx_ids)})

            try:
                await record_parsed_email(session.access_token, session.sheet_id, {
                    "emailId": msg_id, "from": from_, "subject": subject,
                    "parsedAt": now, "status": "partial" if partial else "parsed",
                    "txIds": msg_tx_ids, "attempts": _attempts_of(states, msg_id),
                })
            except Exception:
                pass

            if len(msg_tx_ids) > 1:
                log.info("email", f'imported {len(msg_tx_ids)} rows from "{subject}"',
                         {"messageId": msg_id})
            result["imported"] += len(msg_tx_ids)

        try:
            await deduplicate_new_transactions(session, new_tx_ids)
        except Exception:
            pass

        try:
            await set_meta_values(session.access_token, session.sheet_id, {
                "email_import_last_run": now_iso(),
                "email_import_tx_count": str(config["txCount"] + result["imported"]),
            })
        except Exception:
            pass

        log.info("email", "done", {"scanned": result["scanned"], "imported": result["imported"],
                                   "skipped": result["skipped"], "failed": result["failed"]})
        return result
    finally:
        await _set_meta_safe(session, "email_import_running_at", "")

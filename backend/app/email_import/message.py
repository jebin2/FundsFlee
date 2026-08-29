"""One email, fetched and parsed.

This used to be ~180 lines inline in the import job's loop, which meant the
only way to parse a message was to run a whole import. Re-running a single mail
needs exactly the same pipeline — fetch, extract text, collect attachments,
group into payments, one AI call per group — so it lives here and both callers
use it.

What deliberately stays in the job: attempt counting, retry/backoff and the
parsed_emails bookkeeping. Those describe a scheduled sweep over a backlog, not
a person pressing a button on one row.
"""
import asyncio
from datetime import datetime, timezone

from app.ai.parser import parse_units
from app.core.logger import log
from app.email_import.attachments import fetch_attachments
from app.email_import.mime_text_extractor import extract_payload_text
from app.extract.html_text import extract_email_text
from app.extract.pipeline import collect_message_units, group_units
from app.services.expand_items import rows_from_parsed


async def fetch_message(gmail, msg_id: str) -> dict:
    """The message, reduced to what parsing needs. Raises on a failed fetch —
    the caller decides whether that is a retry or an error to show."""
    msg_res = await asyncio.to_thread(
        lambda: gmail.users().messages().get(
            userId="me", id=msg_id, format="full").execute()
    )
    payload = msg_res.get("payload") or {}
    headers = payload.get("headers") or []

    def header(name: str) -> str:
        return next((h.get("value") or "" for h in headers
                     if (h.get("name") or "").lower() == name), "")

    received_time, received_date = "00:00", None
    if msg_res.get("internalDate"):
        received = datetime.fromtimestamp(
            int(msg_res["internalDate"]) / 1000, tz=timezone.utc)
        received_time = received.strftime("%H:%M")
        received_date = received.strftime("%Y-%m-%d")

    extracted = extract_payload_text(payload)
    return {
        "id": msg_id,
        "from": header("from"),
        "subject": header("subject"),
        "payload": payload,
        "body_text": extract_email_text(extracted["text"], extracted["mimeType"]),
        "received_time": received_time,
        "received_date": received_date,
    }


async def parse_message(gmail, message: dict, region: str, today: str,
                        with_attachments: bool) -> dict:
    """Parse one message into transactions.

    Returns the parsed rows with the headers of the message each actually came
    from — a forwarded batch carries several, and stamping every row with the
    outer forward's headers loses which one it was.
    """
    attachments = []
    if with_attachments:
        try:
            attachments = await fetch_attachments(gmail, message["id"], message["payload"])
        except Exception as err:
            log.error("email", "attachment fetch failed", err,
                      {"messageId": message["id"]})

    units = await collect_message_units(
        {"kind": "email", "text": message["body_text"], "from": message["from"],
         "subject": message["subject"], "date": message["received_date"],
         "source": message["subject"]},
        attachments, message["subject"],
    )
    # One AI call per group. A group is one payment (an order plus its component
    # invoices); a forwarded alert is its own group, so a mail carrying ten of
    # them yields ten transactions, not one.
    groups = group_units(units)

    parsed_rows: list[tuple[dict, str, str]] = []
    skip_reasons: list[str] = []
    failed_groups = 0
    for i, group in enumerate(groups, 1):
        if len(groups) > 1:
            log.info("email", f"group {i}/{len(groups)}",
                     {"messageId": message["id"], "units": len(group)})
        parsed = await parse_units(group, region, today)
        origin = next((u for u in group if u["kind"] == "email"), None)
        origin_subject = (origin or {}).get("subject") or message["subject"]
        origin_from = (origin or {}).get("from") or message["from"]
        for tx in parsed["transactions"]:
            parsed_rows.append((tx, origin_subject, origin_from))
        if parsed["skipReason"]:
            skip_reasons.append(parsed["skipReason"])
        if _group_hard_failed(parsed["skipReason"]):
            failed_groups += 1

    return {"parsed_rows": parsed_rows, "skip_reasons": skip_reasons,
            "failed_groups": failed_groups, "groups": len(groups)}


def build_rows(parsed_rows: list[tuple[dict, str, str]], received_time: str,
               now: str) -> list[dict]:
    """Parsed transactions -> transaction rows ready to append."""
    rows: list[dict] = []
    for transaction, origin_subject, origin_from in parsed_rows:
        base = {
            "date": transaction["date"],
            "time": transaction["time"] if transaction["time"] != "00:00" else received_time,
            "merchant": transaction["merchant"],
            "category": transaction["category"],
            "subcategory": transaction.get("subcategory"),
            "original_amount": transaction.get("original_amount"),
            "original_currency": transaction.get("original_currency"),
            "payment_method": transaction["payment_method"],
            "notes": transaction.get("notes"),
            "tags": transaction.get("tags"),
            "source": "email",
            "raw_input": f"{origin_subject} | {origin_from}"[:500],
        }
        rows.extend(rows_from_parsed(base, transaction, now, transaction["amount"]))
    return rows


def _group_hard_failed(reason: str | None) -> bool:
    """A group that errored rather than reaching a verdict.

    Only parse_error qualifies: the AI chain raised — unreachable, rate-limited,
    401. ai_null deliberately does NOT. In a forwarded batch, a group holding a
    delivery notice rather than a payment returns ai_null perfectly correctly,
    and counting that as a failure would mark ordinary mail "partial" and claim
    rows had been lost when none had.
    """
    return reason == "parse_error"

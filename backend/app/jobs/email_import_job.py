"""Email import job — port of src/server/jobs/emailImportJob.ts."""
import asyncio
from datetime import datetime, timezone

from app.ai.parser import parse_units
from app.core.dates import today_iso, now_iso
from app.core.deps import SheetSession
from app.core.logger import log
from app.email_import.attachments import fetch_attachments
from app.email_import.config import read_email_import_config
from app.email_import.gmail_query import build_gmail_query
from app.email_import.mime_text_extractor import extract_payload_text
from app.extract.html_text import extract_email_text
from app.extract.pipeline import collect_message_units, group_units
from app.services.expand_items import rows_from_parsed
from app.services.duplicate_scan import deduplicate_new_transactions
from app.sheets import (
    append_transactions,
    get_processed_email_ids,
    record_parsed_email,
    set_meta_value,
)
from app.sheets.client import get_gmail_client


async def _set_meta_safe(session: SheetSession, key: str, value: str) -> None:
    try:
        await set_meta_value(session.access_token, session.sheet_id, key, value)
    except Exception:
        pass


async def run_email_import_job(session: SheetSession, manual: bool = False) -> dict:
    config = await read_email_import_config(session)

    # Either filter alone is enough — subject-only catches forwarded alerts.
    if len(config["fromContains"]) == 0 and len(config["subjectContains"]) == 0:
        return {"scanned": 0, "imported": 0, "skipped": 0, "failed": 0}

    if config["runningAt"]:
        age_ms = (datetime.now(timezone.utc) - datetime.fromisoformat(config["runningAt"].replace("Z", "+00:00"))).total_seconds() * 1000
        if age_ms < 5 * 60 * 1000:
            log.warn("email", "already running — skipping")
            return {"scanned": 0, "imported": 0, "skipped": 0, "failed": 0}

    await _set_meta_safe(session, "email_import_running_at", now_iso())

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
            list_res = await asyncio.to_thread(
                lambda: gmail.users().messages().list(userId="me", q=query, maxResults=100).execute()
            )
            message_ids = [m["id"] for m in (list_res.get("messages") or []) if m.get("id")]
        except Exception as err:
            log.error("email", "gmail list failed", err)
            return {"scanned": 0, "imported": 0, "skipped": 0, "failed": 0}

        log.info("email", f"found {len(message_ids)} emails")

        try:
            processed_ids = await get_processed_email_ids(session.access_token, session.sheet_id)
        except Exception:
            processed_ids = set()

        result = {"scanned": 0, "imported": 0, "skipped": 0, "failed": 0}
        new_tx_ids: list[str] = []
        today = today_iso()

        for msg_id in message_ids:
            result["scanned"] += 1

            if msg_id in processed_ids:
                result["skipped"] += 1
                continue

            # Refresh the lock per message. One forwarded batch can take several
            # minutes (an AI call per order), and a stale-looking lock would let
            # the daily cron start alongside this run and import everything twice.
            await _set_meta_safe(session, "email_import_running_at", now_iso())

            from_ = ""
            subject = ""
            body_text = ""
            received_time = "00:00"
            received_date = None
            payload: dict = {}

            try:
                msg_res = await asyncio.to_thread(
                    lambda mid=msg_id: gmail.users().messages().get(userId="me", id=mid, format="full").execute()
                )
                payload = msg_res.get("payload") or {}
                headers = payload.get("headers") or []
                from_ = next((h.get("value") or "" for h in headers if (h.get("name") or "").lower() == "from"), "")
                subject = next((h.get("value") or "" for h in headers if (h.get("name") or "").lower() == "subject"), "")
                if msg_res.get("internalDate"):
                    received = datetime.fromtimestamp(
                        int(msg_res["internalDate"]) / 1000, tz=timezone.utc
                    )
                    received_time = received.strftime("%H:%M")
                    received_date = received.strftime("%Y-%m-%d")
                extracted = extract_payload_text(payload)
                body_text = extract_email_text(extracted["text"], extracted["mimeType"])
            except Exception:
                try:
                    await record_parsed_email(session.access_token, session.sheet_id, {
                        "emailId": msg_id, "from": from_, "subject": subject,
                        "parsedAt": now_iso(), "status": "failed", "txIds": [],
                    })
                except Exception:
                    pass
                result["failed"] += 1
                continue

            # Opt-in. Off, or with nothing attached, this collapses to a
            # single group holding just the body — the same call, fewer units.
            attachments = []
            if config["attachments"]:
                try:
                    attachments = await fetch_attachments(gmail, msg_id, payload)
                except Exception as err:
                    log.error("email", "attachment fetch failed", err, {"messageId": msg_id})

            units = await collect_message_units(
                {"kind": "email", "text": body_text, "from": from_,
                 "subject": subject, "date": received_date, "source": subject},
                attachments, subject,
            )
            # One AI call per group. A group is one payment (an order plus its
            # component invoices); a forwarded alert is its own group, so a mail
            # carrying ten of them yields ten transactions, not one.
            groups = group_units(units)
            # (transaction, origin subject, origin from). Each forwarded alert
            # came from a different message; stamping every row with the outer
            # forward's headers loses which one it actually was.
            parsed_rows: list[tuple[dict, str, str]] = []
            skip_reasons = []
            for i, group in enumerate(groups, 1):
                if len(groups) > 1:
                    log.info("email", f"group {i}/{len(groups)}",
                             {"messageId": msg_id, "units": len(group)})
                parsed = await parse_units(group, config["region"], today)
                origin = next((u for u in group if u["kind"] == "email"), None)
                origin_subject = (origin or {}).get("subject") or subject
                origin_from = (origin or {}).get("from") or from_
                for tx in parsed["transactions"]:
                    parsed_rows.append((tx, origin_subject, origin_from))
                if parsed["skipReason"]:
                    skip_reasons.append(parsed["skipReason"])

            transactions = [tx for tx, _, _ in parsed_rows]
            skip_reason = skip_reasons[0] if skip_reasons and not transactions else None

            if not transactions:
                log.info("email", f'skipped "{subject}"', {"reason": skip_reason})
                try:
                    await record_parsed_email(session.access_token, session.sheet_id, {
                        "emailId": msg_id, "from": from_, "subject": subject,
                        "parsedAt": now_iso(),
                        "status": "failed" if skip_reason == "parse_error" else "skipped",
                        "txIds": [],
                    })
                except Exception:
                    pass
                if skip_reason == "parse_error":
                    result["failed"] += 1
                else:
                    result["skipped"] += 1
                continue

            now = now_iso()
            msg_tx_ids: list[str] = []
            rows_to_write: list[dict] = []
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

                built = rows_from_parsed(base, transaction, now, transaction["amount"])

                for tx in built:
                    rows_to_write.append(tx)
                    msg_tx_ids.append(tx["id"])
                log.info("email", f"imported ₹{transaction['amount']} @ {transaction['merchant']}",
                         {"category": transaction["category"], "rows": len(built), "subject": subject})

            # One request for the whole message, however many rows it produced.
            await append_transactions(session.access_token, session.sheet_id, rows_to_write)
            new_tx_ids.extend(msg_tx_ids)

            try:
                await record_parsed_email(session.access_token, session.sheet_id, {
                    "emailId": msg_id, "from": from_, "subject": subject,
                    "parsedAt": now, "status": "parsed", "txIds": msg_tx_ids,
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
            await asyncio.gather(
                set_meta_value(session.access_token, session.sheet_id, "email_import_last_run", now_iso()),
                set_meta_value(session.access_token, session.sheet_id, "email_import_tx_count",
                               str(config["txCount"] + result["imported"])),
            )
        except Exception:
            pass

        log.info("email", "done", {"scanned": result["scanned"], "imported": result["imported"],
                                   "skipped": result["skipped"], "failed": result["failed"]})
        return result
    finally:
        await _set_meta_safe(session, "email_import_running_at", "")

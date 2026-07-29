"""Email import job — port of src/server/jobs/emailImportJob.ts."""
import asyncio
import uuid
from datetime import datetime, timezone

from app.ai.parse_bundle import parse_email_bundle
from app.ai.parse_email import extract_email_text, parse_email_transaction
from app.core.dates import today_iso, now_iso
from app.core.deps import SheetSession
from app.core.logger import log
from app.email_import.attachments import fetch_attachments
from app.email_import.config import read_email_import_config
from app.email_import.gmail_query import build_gmail_query
from app.email_import.mime_text_extractor import extract_payload_text
from app.extract.pipeline import collect_units
from app.email_import.post_import_duplicate_check import deduplicate_new_transactions
from app.sheets import (
    append_transaction,
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

            from_ = ""
            subject = ""
            body_text = ""
            received_time = "00:00"
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
                    received_time = datetime.fromtimestamp(
                        int(msg_res["internalDate"]) / 1000, tz=timezone.utc
                    ).strftime("%H:%M")
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

            # Opt-in: with attachments on, the whole bundle (body + every
            # attachment) goes to the model in one call so component invoices
            # merge into the single payment they describe. Off, or with nothing
            # attached, the proven body-only path runs unchanged.
            attachments = []
            if config["attachments"]:
                try:
                    attachments = await fetch_attachments(gmail, msg_id, payload)
                except Exception as err:
                    log.error("email", "attachment fetch failed", err, {"messageId": msg_id})

            if attachments:
                units = [{"kind": "email", "text": body_text, "from": from_,
                          "subject": subject, "date": None, "source": subject}]
                for att in attachments:
                    units.extend(await collect_units(
                        att["data"], att["mime_type"], att["filename"] or subject))
                bundle = await parse_email_bundle(units, config["region"], today)
                transactions = bundle["transactions"]
                skip_reason = bundle["skipReason"]
            else:
                parsed = await parse_email_transaction(body_text, from_, subject, config["region"], today)
                transactions = [parsed["transaction"]] if parsed["transaction"] else []
                skip_reason = parsed.get("skipReason")  # absent on success (JS destructure → undefined)

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

            # A statement bundle yields many rows; a purchase yields exactly one.
            now = now_iso()
            msg_tx_ids: list[str] = []
            for transaction in transactions:
                tx = {
                    "id": str(uuid.uuid4()),
                    "date": transaction["date"],
                    "time": transaction["time"] if transaction["time"] != "00:00" else received_time,
                    "amount": transaction["amount"],
                    "merchant": transaction["merchant"],
                    "category": transaction["category"],
                    "item_name": transaction.get("item_name"),
                    "payment_method": transaction["payment_method"],
                    "notes": transaction.get("notes"),
                    "source": "email",
                    "raw_input": f"{subject} | {from_}"[:500],
                    "created_at": now,
                    "updated_at": now,
                    "status": "done",
                }

                await append_transaction(session.access_token, session.sheet_id, tx)
                msg_tx_ids.append(tx["id"])

                log.info("email", f"imported ₹{tx['amount']} @ {tx['merchant']}",
                         {"category": tx["category"], "subject": subject})

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

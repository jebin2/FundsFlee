"""Item normalization service — port of src/server/services/itemNormalizationService.ts."""
import asyncio
import math
from datetime import datetime, timezone

from app.ai.normalize_items import normalize_item_names
from app.ai.parse_notes import extract_from_notes
from app.core.deps import SheetSession
from app.core.dates import now_iso
from app.core.logger import log
from app.sheets import (
    SUPERSEDED,
    append_item_suggestions,
    get_all_transactions,
    get_item_suggestions,
    get_meta_values,
    get_transaction_by_id,
    set_meta_value,
    supersede_note_suggestions,
)

RUN_INTERVAL_MS = 60 * 60 * 1000
BATCH = 50


def _processed_normalize_names(suggestions: list[dict]) -> set[str]:
    return {
        s["current_val"].lower()
        for s in suggestions
        if s["source"] == "normalize" and s["status"] != SUPERSEDED
    }


def _processed_note_keys(suggestions: list[dict]) -> set[str]:
    # Superseded rows do not count as processed: their notes are gone, which is
    # exactly why the transaction should be looked at again.
    return {s["key"] for s in suggestions
            if s["source"] == "notes" and s["status"] != SUPERSEDED}


# Notes shorter than this are not worth an AI call.
MIN_NOTES = 5


def has_usable_notes(tx: dict) -> bool:
    return bool(tx.get("notes")) and len(tx["notes"].strip()) >= MIN_NOTES


async def suggestions_from_notes(txs: list[dict]) -> list[dict]:
    """Read these transactions' notes and propose field values.

    Shared by the sweep and by the single-transaction refresh that runs when
    someone edits notes — one implementation, so a suggestion made on demand is
    the same suggestion the nightly pass would have made.
    """
    to_add: list[dict] = []
    for i in range(0, len(txs), BATCH):
        batch = txs[i:i + BATCH]
        extractions = await extract_from_notes([
            {
                "tx_id": tx["id"],
                "item_name": tx.get("item_name"),
                "notes": tx["notes"],
                "quantity": tx.get("quantity"),
                "merchant": "" if tx.get("merchant") == "Unknown" else tx.get("merchant"),
            }
            for tx in batch
        ])

        for tx in batch:
            ext = extractions.get(tx["id"])

            if ext and ext.get("item_name") and ext["item_name"] != tx.get("item_name"):
                to_add.append({
                    "key": f"tx:{tx['id']}",
                    "field": "item_name",
                    "current_val": tx.get("item_name") or "",
                    "suggested": ext["item_name"],
                    "source": "notes",
                })
            if ext and ext.get("quantity") and ext["quantity"] != tx.get("quantity"):
                to_add.append({
                    "key": f"tx:{tx['id']}",
                    "field": "quantity",
                    "current_val": tx.get("quantity") or "",
                    "suggested": ext["quantity"],
                    "source": "notes",
                })
            if ext and ext.get("merchant") and ext["merchant"] != tx.get("merchant") and tx.get("merchant") == "Unknown":
                to_add.append({
                    "key": f"tx:{tx['id']}",
                    "field": "merchant",
                    "current_val": tx.get("merchant") or "",
                    "suggested": ext["merchant"],
                    "source": "notes",
                })

            # A marker row meaning "these notes were read and yielded nothing".
            # suggested == current_val, so it is never offered; it exists to
            # stop the next sweep paying for the same call again.
            has_any_suggestion = any(s["key"] == f"tx:{tx['id']}" for s in to_add)
            if not has_any_suggestion:
                to_add.append({
                    "key": f"tx:{tx['id']}",
                    "field": "item_name",
                    "current_val": tx.get("item_name") or "",
                    "suggested": tx.get("item_name") or "",
                    "source": "notes",
                })
    return to_add


async def run_item_normalization(session: SheetSession) -> None:
    log.info("normalize", "started")
    try:
        transactions, existing = await asyncio.gather(
            get_all_transactions(session.access_token, session.sheet_id),
            get_item_suggestions(session.access_token, session.sheet_id),
        )

        processed_item_names = _processed_normalize_names(existing)
        processed_tx_keys = _processed_note_keys(existing)
        to_add: list[dict] = []

        # unique item_names, insertion order preserved (JS [...new Set(...)])
        all_item_names = list(dict.fromkeys(
            tx["item_name"] for tx in transactions if tx.get("item_name")
        ))
        new_item_names = [name for name in all_item_names if name.lower() not in processed_item_names]

        for i in range(0, len(new_item_names), BATCH):
            batch = new_item_names[i:i + BATCH]
            groups = await normalize_item_names(batch)

            for group in groups:
                for variant in group["variants"]:
                    if variant.lower() == group["canonical"].lower():
                        continue
                    representative_tx = next(
                        (tx for tx in transactions
                         if tx.get("item_name") is not None and tx["item_name"].lower() == variant.lower()),
                        None,
                    )
                    if not representative_tx:
                        continue
                    to_add.append({
                        "key": f"tx:{representative_tx['id']}",
                        "field": "item_name",
                        "current_val": variant,
                        "suggested": group["canonical"],
                        "source": "normalize",
                    })

            for name in batch:
                already_added = any(
                    s["current_val"].lower() == name.lower() and s["source"] == "normalize"
                    for s in to_add
                )
                if already_added:
                    continue

                representative_tx = next(
                    (tx for tx in transactions
                     if tx.get("item_name") is not None and tx["item_name"].lower() == name.lower()),
                    None,
                )
                if not representative_tx:
                    continue
                to_add.append({
                    "key": f"tx:{representative_tx['id']}",
                    "field": "item_name",
                    "current_val": name,
                    "suggested": name,
                    "source": "normalize",
                })

        tx_with_notes = [
            tx for tx in transactions
            if has_usable_notes(tx)
            and f"tx:{tx['id']}" not in processed_tx_keys
        ]
        to_add.extend(await suggestions_from_notes(tx_with_notes))

        if to_add:
            await append_item_suggestions(session.access_token, session.sheet_id, to_add)

        await set_meta_value(session.access_token, session.sheet_id, "items_normalized_at", now_iso())
        log.info("normalize", "done", {"suggestions": len(to_add)})
    except Exception as err:
        log.error("normalize", "failed", err)


async def request_item_normalization(session: SheetSession) -> dict:
    meta = await get_meta_values(session.access_token, session.sheet_id)
    last_run_iso = meta.get("items_normalized_at")
    last_run = (
        datetime.fromisoformat(last_run_iso.replace("Z", "+00:00")).timestamp() * 1000
        if last_run_iso else 0
    )
    now_ms = datetime.now(timezone.utc).timestamp() * 1000

    if now_ms - last_run < RUN_INTERVAL_MS:
        log.info("normalize", "skipped — ran recently", {"ageS": math.floor((now_ms - last_run) / 1000 + 0.5)})
        return {"skipped": True}

    async def _job():
        try:
            await run_item_normalization(session)
        except Exception as err:
            log.error("normalize", "job failed", err)

    asyncio.create_task(_job())
    return {"started": True}


async def refresh_note_suggestions(session: SheetSession, tx_id: str) -> dict:
    """Re-read one transaction's notes after they were edited.

    Whatever was suggested before described the previous notes, so it is retired
    first — otherwise the old suggestion keeps being offered against details
    that no longer exist, and the append dedup would block the new one anyway.
    """
    retired = await supersede_note_suggestions(
        session.access_token, session.sheet_id, tx_id)

    tx = await get_transaction_by_id(session.access_token, session.sheet_id, tx_id)
    if not tx or not has_usable_notes(tx):
        # Notes cleared or trimmed to nothing. Retiring the stale suggestion is
        # still the right outcome; there is simply nothing to suggest from.
        log.info("normalize", "notes cleared — nothing to re-read",
                 {"txId": tx_id, "retired": retired})
        return {"retired": retired, "added": 0}

    to_add = await suggestions_from_notes([tx])
    if to_add:
        await append_item_suggestions(session.access_token, session.sheet_id, to_add)
    log.info("normalize", "re-read edited notes",
             {"txId": tx_id, "retired": retired, "added": len(to_add)})
    return {"retired": retired, "added": len(to_add)}


def request_note_refresh(session: SheetSession, tx_id: str) -> None:
    """Fire-and-forget: an AI call must not sit inside the save request.

    Not rate-limited like the sweep — this is one transaction the person just
    edited, and they are waiting to see the result.
    """
    async def _job():
        try:
            await refresh_note_suggestions(session, tx_id)
        except Exception as err:
            log.error("normalize", "note refresh failed", err, {"txId": tx_id})

    asyncio.create_task(_job())

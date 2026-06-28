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
    append_item_suggestions,
    get_all_transactions,
    get_item_suggestions,
    get_meta_values,
    set_meta_value,
)

RUN_INTERVAL_MS = 60 * 60 * 1000
BATCH = 50


def _processed_normalize_names(suggestions: list[dict]) -> set[str]:
    return {
        s["current_val"].lower()
        for s in suggestions
        if s["source"] == "normalize"
    }


def _processed_note_keys(suggestions: list[dict]) -> set[str]:
    return {s["key"] for s in suggestions if s["source"] == "notes"}


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
            if tx.get("notes") and len(tx["notes"].strip()) >= 5
            and f"tx:{tx['id']}" not in processed_tx_keys
        ]

        for i in range(0, len(tx_with_notes), BATCH):
            batch = tx_with_notes[i:i + BATCH]
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

                has_any_suggestion = any(s["key"] == f"tx:{tx['id']}" for s in to_add)
                if not has_any_suggestion:
                    to_add.append({
                        "key": f"tx:{tx['id']}",
                        "field": "item_name",
                        "current_val": tx.get("item_name") or "",
                        "suggested": tx.get("item_name") or "",
                        "source": "notes",
                    })

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

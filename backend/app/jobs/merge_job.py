"""Merge job — port of src/server/jobs/mergeJob.ts."""
import asyncio

from app.ai.merge_transactions import merge_transactions
from app.core.dates import now_iso
from app.core.deps import SheetSession
from app.core.logger import log
from app.domain.transactions.metadata import decode_merge_metadata
from app.sheets import get_all_transactions, get_transaction_by_id, update_transaction_field

RETRY_DELAYS_MS = [5_000, 15_000, 45_000]  # 5s, 15s, 45s


def _nn(value, fallback):
    """JS `??` (nullish coalescing) — fallback only when value is None."""
    return value if value is not None else fallback


# Parse the source IDs out of the placeholder's notes field.
# Format stored by the request endpoint: "merge_source:id1,id2,id3"
def parse_merge_source_ids(notes: str | None) -> list[str]:
    return decode_merge_metadata(notes)


async def run_merge_job(session: SheetSession, placeholder_id: str) -> None:
    log.info("merge", "started", {"placeholderId": placeholder_id})

    try:
        await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {"status": "merging"})
    except Exception as err:
        log.error("merge", "failed to set merging status", err, {"placeholderId": placeholder_id})
        try:
            await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {"status": "merge_failed"})
        except Exception:
            pass
        return

    placeholder = await get_transaction_by_id(session.access_token, session.sheet_id, placeholder_id)
    if not placeholder:
        log.error("merge", "placeholder not found", None, {"placeholderId": placeholder_id})
        return

    source_ids = parse_merge_source_ids(placeholder.get("notes"))
    if len(source_ids) < 2:
        log.error("merge", "fewer than 2 source IDs in placeholder notes", None, {"notes": placeholder.get("notes")})
        await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {"status": "merge_failed"})
        return

    # Read all source transactions from the sheet
    all_txs = await get_all_transactions(session.access_token, session.sheet_id)
    by_id = {t["id"]: t for t in all_txs}
    sources = [by_id[sid] for sid in source_ids if sid in by_id]

    if len(sources) < 2:
        log.warn("merge", "could not find all source transactions", {"sourceIds": source_ids, "found": len(sources)})
        await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {"status": "merge_failed"})
        return

    # ── Retry loop ────────────────────────────────────────────────────────────
    last_error: Exception | None = None
    for attempt in range(len(RETRY_DELAYS_MS)):
        if attempt > 0:
            log.info("merge", f"retry attempt {attempt + 1}", {"placeholderId": placeholder_id})
            await asyncio.sleep(RETRY_DELAYS_MS[attempt - 1] / 1000)
        try:
            merged = await merge_transactions(sources)

            now = now_iso()
            receipt_source = next((s for s in sources if s.get("source") == "receipt"), None)

            # merge_id is shared by the merged result AND all source transactions
            # so you can always trace which entries were combined.
            merge_id = placeholder_id

            await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {
                "date": _nn(merged.get("date"), sources[0].get("date")),
                "time": _nn(merged.get("time"), sources[0].get("time")),
                "amount": _nn(merged.get("amount"), sources[0].get("amount")),
                "merchant": _nn(merged.get("merchant"), sources[0].get("merchant")),
                "category": _nn(merged.get("category"), sources[0].get("category")),
                "subcategory": merged.get("subcategory"),
                "item_name": merged.get("item_name"),
                "payment_method": _nn(merged.get("payment_method"), sources[0].get("payment_method")),
                "notes": merged.get("notes"),
                "receipt_url": _nn(merged.get("receipt_url"), receipt_source.get("receipt_url") if receipt_source else None),
                "receipt_id": receipt_source.get("receipt_id") if receipt_source else None,
                "source": "merge",
                "is_duplicate": False,
                "duplicate_ref": None,
                "merge_id": merge_id,
                "status": "done",
                "updated_at": now,
            })

            # Soft-delete all source transactions and stamp them with the same merge_id
            for src in sources:
                await update_transaction_field(session.access_token, session.sheet_id, src["id"], {
                    "deleted": True,
                    "merge_id": merge_id,
                })

            log.info("merge", f"done — merged {len(sources)} transactions", {"placeholderId": placeholder_id})
            return
        except Exception as err:
            last_error = err
            log.warn("merge", f"attempt {attempt + 1} failed", {"placeholderId": placeholder_id, "err": str(err)})

    # All attempts exhausted
    log.error("merge", "all retries failed — marking merge_failed", last_error, {"placeholderId": placeholder_id})
    await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {"status": "merge_failed"})


# Called by the daily cron to retry any stuck merge_failed transactions.
async def retry_failed_merges(session: SheetSession) -> None:
    all_txs = await get_all_transactions(session.access_token, session.sheet_id)
    failed = [t for t in all_txs if t.get("status") == "merge_failed" and t.get("source") == "merge"]
    if not failed:
        return
    log.info("merge", f"retrying {len(failed)} failed merge(s)")
    for tx in failed:
        try:
            await run_merge_job(session, tx["id"])
        except Exception as err:
            log.error("merge", "cron retry failed", err, {"id": tx["id"]})

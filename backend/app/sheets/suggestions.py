"""item_suggestions tab — port of src/lib/sheets/suggestions.ts.

Schema: key | field | current_val | suggested | source | status | updated_at

key   = "tx:{transaction_id}" always — the representative or exact transaction row
field = which Transaction field is being suggested (item_name | quantity | merchant)
source = "normalize" → one row per unique item name (key = any tx with that name)
                        accepting updates ALL transactions with matching current_val
       = "notes"     → one row per transaction (key = that tx's id)
                        accepting updates only that transaction
status = pending | accepted | rejected | superseded

"superseded" means the details the suggestion was derived from have since
changed — the user edited the notes it read. Such a row is kept for the record
but is invisible everywhere: it is not offered, it does not block a fresh
suggestion for the same field, and it does not count as "this transaction has
already been looked at".
"""
import asyncio

from app.core.dates import now_iso
from app.core.logger import log
from app.db import mirror
from app.db.repo import ROW_FIELD

SUPERSEDED = "superseded"


def _at(r: list, i: int) -> str:
    return r[i] if i < len(r) and r[i] is not None else ""


def read_suggestion_rows_sync(access_token: str, sheet_id: str) -> list[list]:
    return mirror.rows(access_token, sheet_id, "item_suggestions")


def _row_to_suggestion(r: list) -> dict:
    return {
        "key": _at(r, 0),
        "field": _at(r, 1) or "item_name",
        "current_val": _at(r, 2),
        "suggested": _at(r, 3),
        "source": _at(r, 4) or "normalize",
        "status": _at(r, 5) or "pending",
        "updated_at": _at(r, 6),
    }


async def get_item_suggestions(access_token: str, sheet_id: str) -> list[dict]:
    def work():
        rows = read_suggestion_rows_sync(access_token, sheet_id)
        return [_row_to_suggestion(r) for r in rows if r and r[0]]
    return await asyncio.to_thread(work)


async def append_item_suggestions(
    access_token: str, sheet_id: str, suggestions: list[dict]
) -> None:
    if not suggestions:
        return

    def work():
        # Dedup against existing — never overwrite an existing entry (any status)
        rows = [r for r in read_suggestion_rows_sync(access_token, sheet_id)
                if _at(r, 5) != SUPERSEDED]
        existing_keys = {f"{_at(r, 0)}::{_at(r, 1)}" for r in rows}
        # For normalize rows, also dedup by current_val+field (key is a tx ID
        # that may differ between runs)
        existing_normalize_vals = {
            f"{_at(r, 2).lower()}::{_at(r, 1)}"
            for r in rows if _at(r, 4) == "normalize"
        }
        to_add = [
            s for s in suggestions
            if f"{s['key']}::{s['field']}" not in existing_keys
            and not (
                s["source"] == "normalize"
                and f"{s['current_val'].lower()}::{s['field']}" in existing_normalize_vals
            )
        ]
        if not to_add:
            return

        now = now_iso()
        mirror.append(access_token, sheet_id, "item_suggestions", [{
            "key": s["key"], "field": s["field"], "current_val": s["current_val"],
            "suggested": s["suggested"], "source": s["source"],
            "status": "pending", "updated_at": now,
        } for s in to_add])

    await asyncio.to_thread(work)


async def resolve_item_suggestion(
    access_token: str, sheet_id: str, key: str, field: str, status: str
) -> None:
    def work():
        mirror.update(access_token, sheet_id, "item_suggestions",
                      {"status": status, "updated_at": now_iso()},
                      key=key, field=field)

    await asyncio.to_thread(work)


def _supersede_note_suggestions_sync(access_token: str, sheet_id: str, tx_id: str) -> int:
    """Retire this transaction's note suggestions — the notes they read are gone.

    Every status, not just pending: an accepted suggestion's value is already
    written onto the transaction, so the row is only a record of a decision
    about text that no longer exists. Leaving it would block a fresh suggestion
    for the same field, since appends dedup on key+field.
    """
    key = f"tx:{tx_id}"
    now = now_iso()
    retired = 0
    for record in mirror.records(access_token, sheet_id, "item_suggestions"):
        if (record.get("key") != key or record.get("source") != "notes"
                or record.get("status") == SUPERSEDED):
            continue
        mirror.update_row(access_token, sheet_id, "item_suggestions",
                          record[ROW_FIELD], {"status": SUPERSEDED, "updated_at": now})
        retired += 1
    if retired:
        log.info("normalize", "retired stale note suggestions",
                 {"txId": tx_id, "count": retired})
    return retired


async def supersede_note_suggestions(access_token: str, sheet_id: str, tx_id: str) -> int:
    return await asyncio.to_thread(
        _supersede_note_suggestions_sync, access_token, sheet_id, tx_id)

"""Post-import duplicate check — port of src/server/email-import/postImportDuplicateCheck.ts.

The port compared against the most recent 200 rows. That works when an import
adds a handful, but an emailed statement can add a hundred rows spanning months:
they flood the recent-200 window and push out the very originals they duplicate.

So the candidate set is scoped by DATE instead of recency — the date of a payment
is stable, unlike its position in the sheet — widened by a few days because card
statements post 1-3 days after the transaction.
"""
from datetime import date, timedelta

from app.ai.dedup import find_duplicates
from app.core.deps import SheetSession
from app.core.logger import log
from app.sheets import get_all_transactions, update_transaction_field

# Covers the gap between a card's transaction date and its posting date.
DEDUP_WINDOW_DAYS = 3


def _as_date(value) -> date | None:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


async def deduplicate_new_transactions(session: SheetSession, new_tx_ids: list[str]) -> None:
    if len(new_tx_ids) == 0:
        return

    all_txs = await get_all_transactions(session.access_token, session.sheet_id)

    # Resolve the new rows to the date span they cover.
    wanted = set(new_tx_ids)
    new_dates = sorted(
        d for d in (_as_date(t.get("date")) for t in all_txs if t.get("id") in wanted) if d
    )
    if not new_dates:
        return

    lo = (new_dates[0] - timedelta(days=DEDUP_WINDOW_DAYS)).isoformat()
    hi = (new_dates[-1] + timedelta(days=DEDUP_WINDOW_DAYS)).isoformat()
    candidates = [t for t in all_txs if lo <= (t.get("date") or "") <= hi]

    log.info("dedup", "scanning for duplicates", {
        "newRows": len(new_tx_ids),
        "span": f"{new_dates[0].isoformat()}..{new_dates[-1].isoformat()}",
        "range": f"{lo}..{hi}",
        "candidates": len(candidates),
    })

    if len(candidates) < 2:
        return

    try:
        groups = await find_duplicates(candidates, window_days=DEDUP_WINDOW_DAYS)
    except Exception as err:
        log.error("dedup", "duplicate scan failed — import kept, nothing flagged", err)
        groups = []

    for group in groups:
        for dup_id in group["duplicate_ids"]:
            try:
                await update_transaction_field(session.access_token, session.sheet_id, dup_id, {
                    "is_duplicate": True,
                    "duplicate_ref": group["original_id"],
                })
            except Exception:
                pass

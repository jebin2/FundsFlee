"""Post-import duplicate check — port of src/server/email-import/postImportDuplicateCheck.ts."""
from app.ai.dedup import find_duplicates
from app.core.deps import SheetSession
from app.sheets import get_transactions, update_transaction_field


async def deduplicate_new_transactions(session: SheetSession, new_tx_ids: list[str]) -> None:
    if len(new_tx_ids) == 0:
        return

    page = await get_transactions(session.access_token, session.sheet_id, 1, 200)
    recent_txs = page["transactions"]

    if len(recent_txs) < 2:
        return

    try:
        groups = await find_duplicates(recent_txs)
    except Exception:
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

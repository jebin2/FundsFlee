"""Transactions tab — port of src/lib/sheets/transactions.ts.

Writes land in the mirror and return; app/db/sync carries them to the sheet on
an interval. Nothing here talks to the Sheets API any more, which is the point:
an import of fifty orders is one local transaction instead of fifty appends and
fifty row lookups against a 60-per-minute quota.
"""
import asyncio
from typing import TypedDict

from app.db import mirror
from app.db.repo import ROW_FIELD
from app.db.registry import EXPECTED_HEADERS, spec
from app.sheets.transaction_schema import (
    is_deleted_row,
    row_to_transaction,
    transaction_to_row,
    transaction_update_to_fields,
)

def _row_number_of(access_token: str, sheet_id: str, tx_id: str) -> int | None:
    """Sheet row holding this id, via the key index.

    The cache this replaces existed because every lookup was an API read of the
    whole id column. Locally it is an indexed lookup, so there is nothing to
    cache and nothing to invalidate.
    """
    found = mirror.find(access_token, sheet_id, "transactions", id=tx_id)
    return found[ROW_FIELD] if found else None


class TransactionPage(TypedDict):
    transactions: list[dict]
    total: int       # non-deleted transactions (excludes header and soft-deleted)
    hasMore: bool    # always False — kept so the response shape is unchanged


def _append_transactions_sync(access_token: str, sheet_id: str, txs: list[dict]) -> None:
    if not txs:
        return
    mirror.append(access_token, sheet_id, "transactions",
                  [dict(zip(EXPECTED_HEADERS, transaction_to_row(tx))) for tx in txs])


async def append_transactions(access_token: str, sheet_id: str, txs: list[dict]) -> None:
    """Write many rows at once. Local, so this no longer costs a request at all
    — the syncer batches them into one when it next runs."""
    await asyncio.to_thread(_append_transactions_sync, access_token, sheet_id, txs)


async def append_transaction(access_token: str, sheet_id: str, tx: dict) -> None:
    await asyncio.to_thread(_append_transactions_sync, access_token, sheet_id, [tx])


# The whole history, in sheet (insert) order — sorting happens client-side.
#
# This used to be a 200-row page counted back from the end of the sheet, because
# every read was a Sheets API call. Locally a full read costs nothing, so the
# client gets everything at once and no longer has to page through it to make
# "All time" or "This year" mean what they say.
async def get_transactions(access_token: str, sheet_id: str) -> TransactionPage:
    txs = await get_all_transactions(access_token, sheet_id)
    return {"transactions": txs, "total": len(txs), "hasMore": False}


def _get_transaction_by_id_sync(access_token: str, sheet_id: str, tx_id: str) -> dict | None:
    found = mirror.find(access_token, sheet_id, "transactions", id=tx_id)
    if not found:
        return None
    row = spec("transactions").to_row(found)
    if is_deleted_row(row):
        return None
    return row_to_transaction(row)


async def get_transaction_by_id(access_token: str, sheet_id: str, tx_id: str) -> dict | None:
    return await asyncio.to_thread(_get_transaction_by_id_sync, access_token, sheet_id, tx_id)


def _update_transaction_field_sync(
    access_token: str, sheet_id: str, tx_id: str, updates: dict
) -> None:
    row_number = _row_number_of(access_token, sheet_id, tx_id)
    if not row_number:
        return
    mirror.update_row(access_token, sheet_id, "transactions", row_number,
                      transaction_update_to_fields(updates))


async def update_transaction_field(
    access_token: str, sheet_id: str, tx_id: str, updates: dict
) -> None:
    await asyncio.to_thread(_update_transaction_field_sync, access_token, sheet_id, tx_id, updates)


def _get_all_transactions_sync(access_token: str, sheet_id: str) -> list[dict]:
    rows = mirror.rows(access_token, sheet_id, "transactions")
    return [
        row_to_transaction(r) for r in rows
        if r and r[0] and not is_deleted_row(r)
    ]


async def get_all_transactions(access_token: str, sheet_id: str) -> list[dict]:
    return await asyncio.to_thread(_get_all_transactions_sync, access_token, sheet_id)

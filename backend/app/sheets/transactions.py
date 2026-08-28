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
from app.db.registry import EXPECTED_HEADERS
from app.sheets.transaction_schema import (
    is_deleted_row,
    row_to_transaction,
    transaction_to_row,
    transaction_update_to_fields,
)

PAGE_SIZE = 200

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
    total: int       # non-deleted transactions in sheet (excludes header and soft-deleted)
    hasMore: bool


# physical — rows with an ID, soft-deleted included — the pagination math
# visible  — rows with an ID that are not deleted — the "X of Y" the user sees
def _get_row_counts(rows: list[list]) -> tuple[int, int]:
    physical = sum(1 for r in rows if r and r[0])
    visible = sum(1 for r in rows if r and r[0] and not is_deleted_row(r))
    return physical, visible


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


# Fetch one page of transactions, working backwards from the end of the sheet.
# Page 1 = most recently appended rows (highest row numbers).
# Rows are in insert order, not date order — sort happens client-side.
def _get_transactions_sync(
    access_token: str, sheet_id: str, page: int, page_size: int
) -> TransactionPage:
    all_rows = mirror.rows(access_token, sheet_id, "transactions")
    physical, visible = _get_row_counts(all_rows)

    if physical == 0:
        return {"transactions": [], "total": 0, "hasMore": False}

    # Same window as before, still expressed in PHYSICAL rows: soft-deleted rows
    # occupy positions and are filtered out after slicing, not before, so page
    # boundaries stay where the sheet has them.
    last_data_row = physical + 1  # +1 for the header row
    end_row = last_data_row - (page - 1) * page_size
    start_row = max(2, end_row - page_size + 1)
    has_more = start_row > 2

    rows = all_rows[start_row - 2:end_row - 1]
    transactions = [
        row_to_transaction(r) for r in rows
        if r and r[0] and not is_deleted_row(r)
    ]

    # Return visible (non-deleted) count so the UI shows "14 of 14" not "14 of 25"
    return {"transactions": transactions, "total": visible, "hasMore": has_more}


async def get_transactions(
    access_token: str, sheet_id: str, page: int = 1, page_size: int = PAGE_SIZE
) -> TransactionPage:
    return await asyncio.to_thread(_get_transactions_sync, access_token, sheet_id, page, page_size)


def _get_transaction_by_id_sync(access_token: str, sheet_id: str, tx_id: str) -> dict | None:
    row = next((r for r in mirror.rows(access_token, sheet_id, "transactions")
                if r and r[0] == tx_id), None)
    if not row or is_deleted_row(row):
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


# Fetch every transaction in one request — for server-side analysis jobs only.
# Not suitable for client-side rendering; use get_transactions() with pagination.
def _get_all_transactions_sync(access_token: str, sheet_id: str) -> list[dict]:
    rows = mirror.rows(access_token, sheet_id, "transactions")
    return [
        row_to_transaction(r) for r in rows
        if r and r[0] and not is_deleted_row(r)
    ]


async def get_all_transactions(access_token: str, sheet_id: str) -> list[dict]:
    return await asyncio.to_thread(_get_all_transactions_sync, access_token, sheet_id)

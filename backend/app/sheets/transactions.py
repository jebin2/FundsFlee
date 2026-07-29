"""Transactions tab — port of src/lib/sheets/transactions.ts."""
import asyncio
from typing import TypedDict

from app.sheets.client import get_sheets_client, with_sheets_retry
from app.sheets.migrations import ensure_transaction_schema_sync
from app.sheets.transaction_schema import (
    COLS,
    ID_RANGE,
    LAST_COL,
    is_deleted_row,
    letter,
    row_to_transaction,
    transaction_to_row,
    transaction_update_to_cells,
)

PAGE_SIZE = 200

# In-memory row-index cache: sheetId → {txId: 1-based sheet row number}
# Invalidated on append (new row not in cache) and on soft-delete (row IDs shift
# logically). Existing row numbers for un-deleted rows remain valid across appends.
_row_index_cache: dict[str, dict[str, int]] = {}


def _get_row_index_map(sheets, sheet_id: str) -> dict[str, int]:
    if sheet_id in _row_index_cache:
        return _row_index_cache[sheet_id]
    res = sheets.spreadsheets().values().get(
        spreadsheetId=sheet_id, range=ID_RANGE
    ).execute()
    index_map: dict[str, int] = {}
    for i, r in enumerate(res.get("values") or []):
        if r and r[0]:
            index_map[str(r[0])] = i + 2  # +2: 1-indexed + header row
    _row_index_cache[sheet_id] = index_map
    return index_map


def invalidate_row_index(sheet_id: str) -> None:
    _row_index_cache.pop(sheet_id, None)


class TransactionPage(TypedDict):
    transactions: list[dict]
    total: int       # non-deleted transactions in sheet (excludes header and soft-deleted)
    hasMore: bool


# Read ID and deleted columns in one batchGet.
#   physical — total rows with an ID (including soft-deleted) — used for pagination math
#   visible  — rows with an ID that are NOT deleted — shown as "X of Y" to the user
def _get_row_counts(sheets, sheet_id: str) -> tuple[int, int]:
    deleted_letter = letter("deleted")
    res = sheets.spreadsheets().values().batchGet(
        spreadsheetId=sheet_id,
        ranges=["transactions!A2:A", f"transactions!{deleted_letter}2:{deleted_letter}"],
        majorDimension="COLUMNS",
    ).execute()
    value_ranges = res.get("valueRanges") or [{}, {}]
    ids = (value_ranges[0].get("values") or [[]])[0]
    deleted = (value_ranges[1].get("values") or [[]])[0] if len(value_ranges) > 1 else []
    physical = sum(1 for v in ids if v)
    visible = sum(
        1 for i, v in enumerate(ids)
        if v and (i >= len(deleted) or deleted[i] != "TRUE")
    )
    return physical, visible


def _append_transactions_sync(access_token: str, sheet_id: str, txs: list[dict]) -> None:
    if not txs:
        return
    sheets = get_sheets_client(access_token)
    ensure_transaction_schema_sync(sheets, sheet_id)
    with_sheets_retry(lambda: sheets.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range="transactions!A2",
        valueInputOption="RAW",
        body={"values": [transaction_to_row(tx) for tx in txs]},
    ).execute())
    # New rows are not in the cache — force rebuild on next update call.
    invalidate_row_index(sheet_id)


async def append_transactions(access_token: str, sheet_id: str, txs: list[dict]) -> None:
    """Write many rows in ONE request.

    Sheets bills per request, not per row, against a per-minute write quota —
    appending a fifty-order import row by row burned fifty of them and risked a
    65-second backoff mid-run.
    """
    await asyncio.to_thread(_append_transactions_sync, access_token, sheet_id, txs)


async def append_transaction(access_token: str, sheet_id: str, tx: dict) -> None:
    await asyncio.to_thread(_append_transactions_sync, access_token, sheet_id, [tx])


# Fetch one page of transactions, working backwards from the end of the sheet.
# Page 1 = most recently appended rows (highest row numbers).
# Rows are in insert order, not date order — sort happens client-side.
def _get_transactions_sync(
    access_token: str, sheet_id: str, page: int, page_size: int
) -> TransactionPage:
    sheets = get_sheets_client(access_token)
    physical, visible = _get_row_counts(sheets, sheet_id)

    if physical == 0:
        return {"transactions": [], "total": 0, "hasMore": False}

    # Pagination uses the PHYSICAL row count so we read the right rows from the
    # sheet. Deleted rows occupy physical space — they're in the range math
    # even though they are filtered out after fetching.
    last_data_row = physical + 1  # +1 for the header row
    end_row = last_data_row - (page - 1) * page_size
    start_row = max(2, end_row - page_size + 1)
    has_more = start_row > 2

    res = sheets.spreadsheets().values().get(
        spreadsheetId=sheet_id,
        range=f"transactions!A{start_row}:{LAST_COL}{end_row}",
    ).execute()

    rows = res.get("values") or []
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
    sheets = get_sheets_client(access_token)
    index_map = _get_row_index_map(sheets, sheet_id)
    row_number = index_map.get(tx_id)
    if not row_number:
        return None

    res = sheets.spreadsheets().values().get(
        spreadsheetId=sheet_id,
        range=f"transactions!A{row_number}:{LAST_COL}{row_number}",
    ).execute()

    rows = res.get("values") or []
    row = rows[0] if rows else None
    if not row or not row[0] or is_deleted_row(row):
        return None
    return row_to_transaction(row)


async def get_transaction_by_id(access_token: str, sheet_id: str, tx_id: str) -> dict | None:
    return await asyncio.to_thread(_get_transaction_by_id_sync, access_token, sheet_id, tx_id)


def _update_transaction_field_sync(
    access_token: str, sheet_id: str, tx_id: str, updates: dict
) -> None:
    sheets = get_sheets_client(access_token)
    index_map = _get_row_index_map(sheets, sheet_id)
    row_number = index_map.get(tx_id)
    if not row_number:
        return

    batch_data = transaction_update_to_cells(updates, row_number)
    if batch_data:
        with_sheets_retry(lambda: sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=sheet_id,
            body={"valueInputOption": "RAW", "data": batch_data},
        ).execute())
        # Soft deletes change the logical row set — invalidate so next update re-fetches
        if updates.get("deleted"):
            invalidate_row_index(sheet_id)


async def update_transaction_field(
    access_token: str, sheet_id: str, tx_id: str, updates: dict
) -> None:
    await asyncio.to_thread(_update_transaction_field_sync, access_token, sheet_id, tx_id, updates)


# Fetch every transaction in one request — for server-side analysis jobs only.
# Not suitable for client-side rendering; use get_transactions() with pagination.
def _get_all_transactions_sync(access_token: str, sheet_id: str) -> list[dict]:
    sheets = get_sheets_client(access_token)
    res = with_sheets_retry(lambda: sheets.spreadsheets().values().get(
        spreadsheetId=sheet_id,
        range=f"transactions!A2:{LAST_COL}",
    ).execute())
    rows = res.get("values") or []
    return [
        row_to_transaction(r) for r in rows
        if r and r[0] and not is_deleted_row(r)
    ]


async def get_all_transactions(access_token: str, sheet_id: str) -> list[dict]:
    return await asyncio.to_thread(_get_all_transactions_sync, access_token, sheet_id)

"""Meta tab (key/value).

Every write used to read meta!A2:A100 first to find the key's row, so saving
four settings cost eight requests against a 60-reads-per-minute quota — and
none of it went through the retry wrapper, so a 429 surfaced as a 500 instead
of backing off. set_meta_values writes a whole batch on one read.
"""
import asyncio

from app.db import mirror
from app.sheets.client import get_sheets_client, with_sheets_retry

_KEY_RANGE = "meta!A2:A100"


def _get_meta_values_sync(access_token: str, sheet_id: str) -> dict[str, str]:
    sheets = get_sheets_client(access_token)
    res = with_sheets_retry(lambda: sheets.spreadsheets().values().get(
        spreadsheetId=sheet_id, range="meta!A2:B100"
    ).execute())
    rows = res.get("values") or []
    return {r[0]: (r[1] if len(r) > 1 and r[1] is not None else "") for r in rows if r and r[0]}


async def get_meta_values(access_token: str, sheet_id: str) -> dict[str, str]:
    return await asyncio.to_thread(_get_meta_values_sync, access_token, sheet_id)


def _set_meta_values_sync(access_token: str, sheet_id: str, values: dict[str, str]) -> None:
    if not values:
        return
    sheets = get_sheets_client(access_token)

    res = with_sheets_retry(lambda: sheets.spreadsheets().values().get(
        spreadsheetId=sheet_id, range=_KEY_RANGE
    ).execute())
    rows = res.get("values") or []
    row_of = {r[0]: i + 2 for i, r in enumerate(rows) if r and r[0]}

    updates = [
        {"range": f"meta!B{row_of[k]}", "values": [[v]]}
        for k, v in values.items() if k in row_of
    ]
    additions = [[k, v] for k, v in values.items() if k not in row_of]

    if updates:
        with_sheets_retry(lambda: sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=sheet_id,
            body={"valueInputOption": "RAW", "data": updates},
        ).execute())

    if additions:
        with_sheets_retry(lambda: sheets.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range="meta!A2",
            valueInputOption="RAW",
            body={"values": additions},
        ).execute())

    # Phase 2 dual-write, split the same way: existing keys are updates,
    # new ones are appends, so the mirror lands on the same rows.
    for k, v in values.items():
        if k in row_of:
            mirror.update(access_token, sheet_id, "meta", {"value": v}, key=k)
    mirror.append(access_token, sheet_id, "meta",
                  [{"key": k, "value": v} for k, v in additions])


async def set_meta_values(access_token: str, sheet_id: str, values: dict[str, str]) -> None:
    """Write several keys on a single read. Prefer this over looping."""
    await asyncio.to_thread(_set_meta_values_sync, access_token, sheet_id, values)


async def set_meta_value(access_token: str, sheet_id: str, key: str, value: str) -> None:
    await asyncio.to_thread(_set_meta_values_sync, access_token, sheet_id, {key: value})

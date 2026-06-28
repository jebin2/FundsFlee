"""Meta tab (key/value) — port of src/lib/sheets/meta.ts."""
import asyncio

from app.sheets.client import get_sheets_client


def _get_meta_values_sync(access_token: str, sheet_id: str) -> dict[str, str]:
    sheets = get_sheets_client(access_token)
    res = sheets.spreadsheets().values().get(
        spreadsheetId=sheet_id, range="meta!A2:B100"
    ).execute()
    rows = res.get("values") or []
    return {r[0]: (r[1] if len(r) > 1 and r[1] is not None else "") for r in rows if r and r[0]}


async def get_meta_values(access_token: str, sheet_id: str) -> dict[str, str]:
    return await asyncio.to_thread(_get_meta_values_sync, access_token, sheet_id)


def _set_meta_value_sync(access_token: str, sheet_id: str, key: str, value: str) -> None:
    sheets = get_sheets_client(access_token)

    res = sheets.spreadsheets().values().get(
        spreadsheetId=sheet_id, range="meta!A2:A100"
    ).execute()
    rows = res.get("values") or []
    row_index = next((i for i, r in enumerate(rows) if r and r[0] == key), -1)

    if row_index >= 0:
        sheets.spreadsheets().values().update(
            spreadsheetId=sheet_id,
            range=f"meta!B{row_index + 2}",
            valueInputOption="RAW",
            body={"values": [[value]]},
        ).execute()
    else:
        sheets.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range="meta!A2",
            valueInputOption="RAW",
            body={"values": [[key, value]]},
        ).execute()


async def set_meta_value(access_token: str, sheet_id: str, key: str, value: str) -> None:
    await asyncio.to_thread(_set_meta_value_sync, access_token, sheet_id, key, value)

"""Categories tab — port of src/lib/sheets/categories.ts."""
import asyncio

from app.db import mirror
from app.sheets.client import get_sheets_client, with_sheets_retry


def _row_to_category(r: list) -> dict:
    def at(i: int) -> str:
        return r[i] if i < len(r) and r[i] is not None else ""
    cat = {
        "id": at(0),
        "name": at(1),
        "color": at(3),
        "icon": at(4),
        "is_default": at(5) == "true",
        "created_at": at(6),
    }
    if at(2):
        cat["parent_id"] = at(2)
    return cat


def _get_categories_sync(access_token: str, sheet_id: str) -> list[dict]:
    rows = mirror.rows(access_token, sheet_id, "categories")
    return [_row_to_category(r) for r in rows if len(r) > 1 and r[0] and r[1]]


async def get_categories(access_token: str, sheet_id: str) -> list[dict]:
    return await asyncio.to_thread(_get_categories_sync, access_token, sheet_id)


def _append_category_sync(access_token: str, sheet_id: str, cat: dict) -> None:
    sheets = get_sheets_client(access_token)
    with_sheets_retry(lambda: sheets.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range="categories!A2",
        valueInputOption="RAW",
        body={"values": [[cat["id"], cat["name"], "", cat["color"], cat["icon"], "false", cat["created_at"]]]},
    ).execute())

    mirror.append(access_token, sheet_id, "categories", [{
        "id": cat["id"], "name": cat["name"], "parent_id": "",
        "color": cat["color"], "icon": cat["icon"], "is_default": "false",
        "created_at": cat["created_at"],
    }])


async def append_category(access_token: str, sheet_id: str, cat: dict) -> None:
    await asyncio.to_thread(_append_category_sync, access_token, sheet_id, cat)


def _delete_category_by_id_sync(access_token: str, sheet_id: str, cat_id: str) -> None:
    sheets = get_sheets_client(access_token)
    rows = mirror.rows(access_token, sheet_id, "categories")
    row_index = next((i for i, r in enumerate(rows) if r and r[0] == cat_id), -1)
    if row_index < 0:
        return
    # Clear the name to soft-delete (row stays but is filtered out on read)
    with_sheets_retry(lambda: sheets.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range=f"categories!A{row_index + 2}:G{row_index + 2}",
        valueInputOption="RAW",
        body={"values": [["", "", "", "", "", "", ""]]},
    ).execute())

    # Blanked, not removed — the row keeps its position, in both stores.
    mirror.blank_row(access_token, sheet_id, "categories", row_index + 2)


async def delete_category_by_id(access_token: str, sheet_id: str, cat_id: str) -> None:
    await asyncio.to_thread(_delete_category_by_id_sync, access_token, sheet_id, cat_id)

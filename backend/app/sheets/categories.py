"""Categories tab — port of src/lib/sheets/categories.ts."""
import asyncio

from app.db import mirror
from app.db.repo import ROW_FIELD


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
    mirror.append(access_token, sheet_id, "categories", [{
        "id": cat["id"], "name": cat["name"], "parent_id": "",
        "color": cat["color"], "icon": cat["icon"], "is_default": "false",
        "created_at": cat["created_at"],
    }])


async def append_category(access_token: str, sheet_id: str, cat: dict) -> None:
    await asyncio.to_thread(_append_category_sync, access_token, sheet_id, cat)


def _delete_category_by_id_sync(access_token: str, sheet_id: str, cat_id: str) -> None:
    found = mirror.find(access_token, sheet_id, "categories", id=cat_id)
    if not found:
        return
    # Blanked, not removed: the row keeps its position, so no row below it
    # shifts onto the wrong sheet line. Reads filter out nameless rows.
    mirror.blank_row(access_token, sheet_id, "categories", found[ROW_FIELD])


async def delete_category_by_id(access_token: str, sheet_id: str, cat_id: str) -> None:
    await asyncio.to_thread(_delete_category_by_id_sync, access_token, sheet_id, cat_id)

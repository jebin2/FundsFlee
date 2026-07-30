"""item_suggestions tab — port of src/lib/sheets/suggestions.ts.

Schema: key | field | current_val | suggested | source | status | updated_at

key   = "tx:{transaction_id}" always — the representative or exact transaction row
field = which Transaction field is being suggested (item_name | quantity | merchant)
source = "normalize" → one row per unique item name (key = any tx with that name)
                        accepting updates ALL transactions with matching current_val
       = "notes"     → one row per transaction (key = that tx's id)
                        accepting updates only that transaction
status = pending | accepted | rejected
"""
import asyncio


from app.core.dates import now_iso
from app.db import mirror
from app.sheets.client import get_sheets_client
from app.sheets.headers import ITEM_SUGGESTIONS_HEADERS


def _at(r: list, i: int) -> str:
    return r[i] if i < len(r) and r[i] is not None else ""


def ensure_item_suggestions_tab_sync(sheets, sheet_id: str) -> None:
    meta = sheets.spreadsheets().get(
        spreadsheetId=sheet_id, fields="sheets.properties.title"
    ).execute()
    exists = any(
        s.get("properties", {}).get("title") == "item_suggestions"
        for s in meta.get("sheets") or []
    )
    if exists:
        return

    sheets.spreadsheets().batchUpdate(
        spreadsheetId=sheet_id,
        body={"requests": [{"addSheet": {"properties": {"title": "item_suggestions"}}}]},
    ).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range="item_suggestions!A1:G1",
        valueInputOption="RAW",
        body={"values": [list(ITEM_SUGGESTIONS_HEADERS)]},
    ).execute()


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
        sheets = get_sheets_client(access_token)

        # Dedup against existing — never overwrite an existing entry (any status)
        rows = read_suggestion_rows_sync(access_token, sheet_id)
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
        sheets.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range="item_suggestions!A2",
            valueInputOption="RAW",
            body={"values": [
                [s["key"], s["field"], s["current_val"], s["suggested"], s["source"], "pending", now]
                for s in to_add
            ]},
        ).execute()

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
        sheets = get_sheets_client(access_token)
        rows = read_suggestion_rows_sync(access_token, sheet_id)
        idx = next(
            (i for i, r in enumerate(rows) if _at(r, 0) == key and _at(r, 1) == field), -1
        )
        if idx < 0:
            return
        now = now_iso()
        sheets.spreadsheets().values().update(
            spreadsheetId=sheet_id,
            range=f"item_suggestions!F{idx + 2}:G{idx + 2}",
            valueInputOption="RAW",
            body={"values": [[status, now]]},
        ).execute()

        mirror.update(access_token, sheet_id, "item_suggestions",
                      {"status": status, "updated_at": now}, key=key, field=field)

    await asyncio.to_thread(work)

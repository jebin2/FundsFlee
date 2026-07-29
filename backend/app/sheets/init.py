"""Spending-sheet bootstrap — port of src/lib/sheets/init.ts."""
import asyncio

from app.sheets.client import execute, get_drive_client, get_sheets_client
from app.sheets.default_categories import seed_default_categories_sync
from app.sheets.headers import (
    ANALYSIS_CACHE_HEADERS,
    CATEGORIES_HEADERS,
    EXPECTED_HEADERS,
    ITEM_SUGGESTIONS_HEADERS,
    META_HEADERS,
    PARSED_EMAILS_HEADERS,
)
from app.sheets.transactions import invalidate_row_index
from app.sheets.migrations import (
    ensure_parsed_emails_tab_sync,
    ensure_transaction_schema_sync,
)

# appProperties are tied to our OAuth client ID — invisible in Drive UI,
# survives renames/moves, and is the authoritative app identifier.
APP_PROP_KEY = "fundsFleeRole"
APP_SHEET_ROLE = "main"
SHEET_DISPLAY_NAME = "FundsFlee"

_TAB_TITLES = ["transactions", "categories", "analysis_cache", "item_suggestions", "meta", "parsed_emails"]


def _col_letter(count: int) -> str:
    """1-based column count -> its letter (26 -> Z, 27 -> AA)."""
    out = ""
    while count:
        count, rem = divmod(count - 1, 26)
        out = chr(65 + rem) + out
    return out


# Ranges are derived from the header tuples, never written out by hand: a
# hand-typed A2:Z is how column AA came to be skipped by both the header write
# and the reset.
_TABS = (
    ("transactions", EXPECTED_HEADERS),
    ("categories", CATEGORIES_HEADERS),
    ("analysis_cache", ANALYSIS_CACHE_HEADERS),
    ("item_suggestions", ITEM_SUGGESTIONS_HEADERS),
    ("meta", META_HEADERS),
    ("parsed_emails", PARSED_EMAILS_HEADERS),
)

_HEADER_WRITES = [
    (f"{tab}!A1:{_col_letter(len(headers))}1", headers) for tab, headers in _TABS
]
_DATA_RANGES = [f"{tab}!A2:{_col_letter(len(headers))}" for tab, headers in _TABS]


def _init_spending_sheet_sync(access_token: str, _user_name: str) -> dict:
    drive = get_drive_client(access_token)
    sheets = get_sheets_client(access_token)

    # Look up by appProperties — works even if the user renames the sheet
    existing = execute(
        drive.files().list(
            q=(
                f"appProperties has {{ key='{APP_PROP_KEY}' and value='{APP_SHEET_ROLE}' }} "
                "and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
            ),
            fields="files(id,webViewLink)",
            spaces="drive",
            pageSize=1,
        )
    )

    files = existing.get("files") or []
    if files:
        sheet_id = files[0]["id"]
        sheet_url = files[0].get("webViewLink") or f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
        try:
            ensure_transaction_schema_sync(sheets, sheet_id)
        except Exception:
            pass
        try:
            ensure_parsed_emails_tab_sync(sheets, sheet_id)
        except Exception:
            pass
        return {"sheetId": sheet_id, "sheetUrl": sheet_url, "isNew": False}

    spreadsheet = sheets.spreadsheets().create(
        body={
            "properties": {"title": SHEET_DISPLAY_NAME},
            "sheets": [{"properties": {"title": t}} for t in _TAB_TITLES],
        }
    ).execute()

    sheet_id = spreadsheet["spreadsheetId"]
    sheet_url = spreadsheet.get("spreadsheetUrl") or f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"

    # Stamp the appProperty so future lookups use it instead of the name
    drive.files().update(
        fileId=sheet_id,
        body={"appProperties": {APP_PROP_KEY: APP_SHEET_ROLE}},
    ).execute()

    for range_, headers in _HEADER_WRITES:
        sheets.spreadsheets().values().update(
            spreadsheetId=sheet_id,
            range=range_,
            valueInputOption="RAW",
            body={"values": [list(headers)]},
        ).execute()

    seed_default_categories_sync(sheets, sheet_id)

    sheets.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range="meta!A2",
        valueInputOption="RAW",
        body={"values": [["sheet_url", sheet_url]]},
    ).execute()

    return {"sheetId": sheet_id, "sheetUrl": sheet_url, "isNew": True}


async def init_spending_sheet(access_token: str, user_name: str) -> dict:
    """Returns { sheetId, sheetUrl, isNew }."""
    return await asyncio.to_thread(_init_spending_sheet_sync, access_token, user_name)


def _reset_sheet_sync(access_token: str, sheet_id: str) -> None:
    sheets = get_sheets_client(access_token)

    sheets.spreadsheets().values().batchClear(
        spreadsheetId=sheet_id, body={"ranges": _DATA_RANGES},
    ).execute()

    # Rewrite the headers: a reset should leave a correct schema behind, not
    # just empty rows under whatever header row happened to be there.
    for range_, headers in _HEADER_WRITES:
        sheets.spreadsheets().values().update(
            spreadsheetId=sheet_id,
            range=range_,
            valueInputOption="RAW",
            body={"values": [list(headers)]},
        ).execute()

    # Every cached id -> row number now points at a cleared row.
    invalidate_row_index(sheet_id)

    sheet_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
    seed_default_categories_sync(sheets, sheet_id)
    sheets.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range="meta!A2",
        valueInputOption="RAW",
        body={"values": [["sheet_url", sheet_url]]},
    ).execute()


async def reset_sheet(access_token: str, sheet_id: str) -> None:
    await asyncio.to_thread(_reset_sheet_sync, access_token, sheet_id)

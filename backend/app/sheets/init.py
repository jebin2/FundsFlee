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

_HEADER_WRITES = [
    ("transactions!A1:AA1", EXPECTED_HEADERS),
    ("categories!A1:G1", CATEGORIES_HEADERS),
    ("analysis_cache!A1:G1", ANALYSIS_CACHE_HEADERS),
    ("item_suggestions!A1:G1", ITEM_SUGGESTIONS_HEADERS),
    ("meta!A1:B1", META_HEADERS),
    ("parsed_emails!A1:F1", PARSED_EMAILS_HEADERS),
]


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
        spreadsheetId=sheet_id,
        body={
            "ranges": [
                "transactions!A2:Z",
                "categories!A2:G",
                "analysis_cache!A2:G",
                "item_suggestions!A2:G",
                "parsed_emails!A2:F",
                "meta!A2:B",
            ]
        },
    ).execute()

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

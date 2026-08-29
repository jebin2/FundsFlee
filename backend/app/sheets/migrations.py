"""Schema migrations for existing sheets — port of src/lib/sheets/schema/migrations.ts.
Sync functions (call off the event loop); per-process memo sets avoid
re-checking the same sheet."""
from googleapiclient.errors import HttpError

from app.db.registry import spec
from app.sheets.headers import (
    EXPECTED_HEADERS,
    ITEM_SUGGESTIONS_HEADERS,
    PARSED_EMAILS_HEADERS,
)

_schema_checked: set[str] = set()
_parsed_emails_tab_checked: set[str] = set()
_item_suggestions_tab_checked: set[str] = set()

# Derived so adding a column to the header tuple is the only edit needed.
_PARSED_EMAILS_LAST_COL = chr(ord("A") + len(PARSED_EMAILS_HEADERS) - 1)
_date_format_checked: set[str] = set()

# Pinned so the sheet hands dates back exactly as the app writes them. Without
# this the displayed (and therefore read) value follows the sheet's locale —
# 29/07/2026 — and every date comparison in the app breaks at once.
DATE_PATTERN = "yyyy-mm-dd"


def _tab_gid(sheets, sheet_id: str, title: str) -> int | None:
    meta = sheets.spreadsheets().get(
        spreadsheetId=sheet_id, fields="sheets(properties(sheetId,title))"
    ).execute()
    for sheet in meta.get("sheets") or []:
        props = sheet.get("properties") or {}
        if props.get("title") == title:
            return props.get("sheetId")
    return None


def ensure_date_column_format_sync(sheets, sheet_id: str) -> None:
    """Format the transactions date column as a real date, once per process."""
    if sheet_id in _date_format_checked:
        return
    _date_format_checked.add(sheet_id)  # a failure here must not retry every write

    try:
        gid = _tab_gid(sheets, sheet_id, "transactions")
        if gid is None:
            return
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=sheet_id,
            body={"requests": [{
                "repeatCell": {
                    "range": {
                        "sheetId": gid,
                        "startRowIndex": 1,          # keep the header as text
                        "startColumnIndex": 1,       # column B — date
                        "endColumnIndex": 2,
                    },
                    "cell": {"userEnteredFormat": {
                        "numberFormat": {"type": "DATE", "pattern": DATE_PATTERN}
                    }},
                    "fields": "userEnteredFormat.numberFormat",
                }
            }]},
        ).execute()
    except HttpError:
        pass  # dates stay text — readable, just not filterable by range


def ensure_parsed_emails_tab_sync(sheets, sheet_id: str) -> None:
    if sheet_id in _parsed_emails_tab_checked:
        return

    header_range = f"parsed_emails!A1:{_PARSED_EMAILS_LAST_COL}1"
    try:
        res = sheets.spreadsheets().values().get(
            spreadsheetId=sheet_id, range=header_range
        ).execute()
        # Tab exists. Rewrite the header if a column has since been added, so
        # the sheet stays self-describing — the data is written to the wider
        # range either way, it would just sit under a blank heading.
        current = (res.get("values") or [[]])[0]
        if list(current) != list(PARSED_EMAILS_HEADERS):
            try:
                sheets.spreadsheets().values().update(
                    spreadsheetId=sheet_id, range=header_range,
                    valueInputOption="RAW",
                    body={"values": [list(PARSED_EMAILS_HEADERS)]},
                ).execute()
            except HttpError:
                pass
        _parsed_emails_tab_checked.add(sheet_id)
        return
    except HttpError:
        pass  # Tab doesn't exist yet — fall through to create it

    try:
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=sheet_id,
            body={"requests": [{"addSheet": {"properties": {"title": "parsed_emails"}}}]},
        ).execute()
    except HttpError:
        pass

    try:
        sheets.spreadsheets().values().update(
            spreadsheetId=sheet_id,
            range=f"parsed_emails!A1:{_PARSED_EMAILS_LAST_COL}1",
            valueInputOption="RAW",
            body={"values": [list(PARSED_EMAILS_HEADERS)]},
        ).execute()
    except HttpError:
        pass

    _parsed_emails_tab_checked.add(sheet_id)


def ensure_transaction_schema_sync(sheets, sheet_id: str) -> None:
    if sheet_id in _schema_checked:
        return

    # Derived, never typed. A literal A1:AA1 here reads and writes 27 columns
    # whatever EXPECTED_HEADERS says, so the 28th would silently never arrive —
    # which is the same failure this module's docstring already describes once.
    header_range = spec("transactions").header_range
    res = sheets.spreadsheets().values().get(
        spreadsheetId=sheet_id, range=header_range
    ).execute()
    current = (res.get("values") or [[]])[0]
    if len(current) >= len(EXPECTED_HEADERS):
        _schema_checked.add(sheet_id)
        return
    sheets.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range=header_range,
        valueInputOption="RAW",
        body={"values": [list(EXPECTED_HEADERS)]},
    ).execute()
    _schema_checked.add(sheet_id)


def ensure_item_suggestions_tab_sync(sheets, sheet_id: str) -> None:
    """The tab is newer than the oldest sheets, so it may not exist. It has to,
    or the syncer's push for it fails on every tick."""
    if sheet_id in _item_suggestions_tab_checked:
        return
    _item_suggestions_tab_checked.add(sheet_id)
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
        range=spec("item_suggestions").header_range,
        valueInputOption="RAW",
        body={"values": [list(ITEM_SUGGESTIONS_HEADERS)]},
    ).execute()

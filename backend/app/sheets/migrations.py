"""Schema migrations for existing sheets — port of src/lib/sheets/schema/migrations.ts.
Sync functions (call off the event loop); per-process memo sets avoid
re-checking the same sheet."""
from googleapiclient.errors import HttpError

from app.sheets.headers import EXPECTED_HEADERS, PARSED_EMAILS_HEADERS

_schema_checked: set[str] = set()
_parsed_emails_tab_checked: set[str] = set()
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

    try:
        sheets.spreadsheets().values().get(
            spreadsheetId=sheet_id, range="parsed_emails!A1"
        ).execute()
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
            range="parsed_emails!A1:F1",
            valueInputOption="RAW",
            body={"values": [list(PARSED_EMAILS_HEADERS)]},
        ).execute()
    except HttpError:
        pass

    _parsed_emails_tab_checked.add(sheet_id)


def ensure_transaction_schema_sync(sheets, sheet_id: str) -> None:
    if sheet_id in _schema_checked:
        return

    res = sheets.spreadsheets().values().get(
        spreadsheetId=sheet_id, range="transactions!A1:AA1"
    ).execute()
    current = (res.get("values") or [[]])[0]
    if len(current) >= len(EXPECTED_HEADERS):
        _schema_checked.add(sheet_id)
        return
    sheets.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range="transactions!A1:AA1",
        valueInputOption="RAW",
        body={"values": [list(EXPECTED_HEADERS)]},
    ).execute()
    _schema_checked.add(sheet_id)

"""Schema migrations for existing sheets — port of src/lib/sheets/schema/migrations.ts.
Sync functions (call off the event loop); per-process memo sets avoid
re-checking the same sheet."""
from googleapiclient.errors import HttpError

from app.sheets.headers import EXPECTED_HEADERS, PARSED_EMAILS_HEADERS

_schema_checked: set[str] = set()
_parsed_emails_tab_checked: set[str] = set()


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
        spreadsheetId=sheet_id, range="transactions!A1:Z1"
    ).execute()
    current = (res.get("values") or [[]])[0]
    if len(current) >= len(EXPECTED_HEADERS):
        _schema_checked.add(sheet_id)
        return
    sheets.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range="transactions!A1:Z1",
        valueInputOption="RAW",
        body={"values": [list(EXPECTED_HEADERS)]},
    ).execute()
    _schema_checked.add(sheet_id)

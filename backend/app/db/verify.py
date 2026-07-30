"""Diff the mirror against the sheet.

This is what makes dual-write provable rather than hopeful. Run the app
normally, then run this: if every tab matches cell for cell, reads can move to
the mirror in Phase 3 on evidence.

It compares by POSITION, not by key. Two stores holding the same rows in a
different order is not a match — position is row identity here, so a shift is
exactly the corruption worth catching.
"""
import asyncio

from googleapiclient.errors import HttpError

from app.db.connection import connect, mirror_exists
from app.db.registry import TABS, TabSpec
from app.db.repo import Repo
from app.sheets.client import get_sheets_client, with_sheets_retry

# Enough to see the shape of a problem without printing a whole sheet.
MAX_REPORTED = 10


def _read_sheet(sheets, sheet_id: str, spec: TabSpec) -> list[list[str]]:
    try:
        res = with_sheets_retry(lambda: sheets.spreadsheets().values().get(
            spreadsheetId=sheet_id, range=spec.data_range
        ).execute())
    except HttpError as err:
        if "Unable to parse range" in str(err) or "not found" in str(err):
            return []
        raise
    width = len(spec.columns)
    out = []
    for row in (res.get("values") or []):
        cells = ["" if c is None else str(c) for c in row[:width]]
        out.append(cells + [""] * (width - len(cells)))
    return out


def _compare_tab(conn, sheets, sheet_id: str, spec: TabSpec) -> dict:
    sheet_rows = _read_sheet(sheets, sheet_id, spec)
    local_rows = [spec.to_row(r) for r in Repo(conn, spec).all()]

    diffs = []
    for i in range(max(len(sheet_rows), len(local_rows))):
        want = sheet_rows[i] if i < len(sheet_rows) else None
        got = local_rows[i] if i < len(local_rows) else None
        if want == got:
            continue
        if len(diffs) < MAX_REPORTED:
            entry = {"row": i + 2}
            if want is None:
                entry["problem"] = "only in mirror"
            elif got is None:
                entry["problem"] = "only in sheet"
            else:
                entry["problem"] = "differs"
                entry["columns"] = [
                    spec.columns[c] for c in range(len(spec.columns))
                    if want[c] != got[c]
                ][:6]
            diffs.append(entry)

    total_diffs = sum(
        1 for i in range(max(len(sheet_rows), len(local_rows)))
        if (sheet_rows[i] if i < len(sheet_rows) else None)
        != (local_rows[i] if i < len(local_rows) else None)
    )
    return {
        "sheetRows": len(sheet_rows),
        "localRows": len(local_rows),
        "differences": total_diffs,
        "ok": total_diffs == 0,
        "sample": diffs,
    }


def verify_sync(access_token: str, sheet_id: str) -> dict:
    if not mirror_exists(sheet_id):
        return {"ok": False, "reason": "no local mirror — nothing to compare"}

    sheets = get_sheets_client(access_token)
    conn = connect(sheet_id)
    try:
        tabs = {s.name: _compare_tab(conn, sheets, sheet_id, s) for s in TABS}
    finally:
        conn.close()
    return {"ok": all(t["ok"] for t in tabs.values()), "tabs": tabs}


async def verify(access_token: str, sheet_id: str) -> dict:
    return await asyncio.to_thread(verify_sync, access_token, sheet_id)

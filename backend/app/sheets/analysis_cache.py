"""analysis_cache tab — port of src/lib/sheets/analysis-cache.ts.

Columns: A=id B=period C=period_type D=summary_json E=generated_at F=status G=drive_file_id
status: "generating" | "done" | "failed" | "cancelled"
"""
import asyncio
import math
import uuid
from datetime import datetime, timedelta, timezone

from googleapiclient.http import MediaInMemoryUpload

from app.core.dates import now_iso, today_iso
from app.db import mirror
from app.db.registry import ANALYSIS_CACHE_HEADERS
from app.sheets.client import get_drive_client
from app.sheets.drive import get_or_create_receipts_folder_sync

# If JSON is larger than this, store it in Drive instead of the cell
ANALYSIS_CELL_LIMIT = 40000


def _at(r: list, i: int) -> str:
    return r[i] if i < len(r) and r[i] is not None else ""


def _read_rows_sync(access_token: str, sheet_id: str) -> list[list]:
    return mirror.rows(access_token, sheet_id, "analysis_cache")


def _row_to_cached_analysis(row: list) -> dict:
    cached = {
        "id": _at(row, 0),
        "period": _at(row, 1),
        "period_type": _at(row, 2),
        "summary_json": _at(row, 3),
        "generated_at": _at(row, 4),
        "status": _at(row, 5) or "done",
    }
    if _at(row, 6):
        cached["drive_file_id"] = _at(row, 6)
    return cached


def _get_analysis_cache_sync(
    access_token: str, sheet_id: str, period: str, max_age_hours: float
) -> dict | None:
    rows = _read_rows_sync(access_token, sheet_id)

    # For "generating" entries, always return regardless of TTL so client can poll
    generating = next(
        (r for r in rows if _at(r, 1) == period and _at(r, 5) == "generating"), None
    )
    if generating:
        return _row_to_cached_analysis(generating)

    if math.isfinite(max_age_hours):
        cutoff = (
            datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
        ).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    else:
        cutoff = "0000-00-00"
    row = next(
        (r for r in rows
         if _at(r, 1) == period and _at(r, 5) == "done" and _at(r, 4) >= cutoff),
        None,
    )
    if not row:
        # Check for failed entry (return without TTL)
        failed = next(
            (r for r in rows if _at(r, 1) == period and _at(r, 5) == "failed"), None
        )
        return _row_to_cached_analysis(failed) if failed else None

    return _row_to_cached_analysis(row)


async def get_analysis_cache(
    access_token: str, sheet_id: str, period: str, max_age_hours: float = 24
) -> dict | None:
    return await asyncio.to_thread(
        _get_analysis_cache_sync, access_token, sheet_id, period, max_age_hours
    )


def _upsert_analysis_cache_row_sync(
    access_token: str,
    sheet_id: str,
    period: str,
    period_type: str,
    status: str,
    summary_json: str = "",
    drive_file_id: str = "",
) -> None:
    rows = _read_rows_sync(access_token, sheet_id)
    values = [str(uuid.uuid4()), period, period_type, summary_json, now_iso(), status, drive_file_id]
    record = dict(zip(ANALYSIS_CACHE_HEADERS, values))

    # One row per period: overwrite the existing one rather than stacking a new
    # row on every regeneration.
    idx = next((i for i, r in enumerate(rows) if _at(r, 1) == period), -1)
    if idx >= 0:
        mirror.update_row(access_token, sheet_id, "analysis_cache", idx + 2, record)
    else:
        mirror.append(access_token, sheet_id, "analysis_cache", [record])


async def upsert_analysis_cache_row(
    access_token: str,
    sheet_id: str,
    period: str,
    period_type: str,
    status: str,
    summary_json: str = "",
    drive_file_id: str = "",
) -> None:
    await asyncio.to_thread(
        _upsert_analysis_cache_row_sync,
        access_token, sheet_id, period, period_type, status, summary_json, drive_file_id,
    )


def _store_analysis_in_drive_sync(
    access_token: str, sheet_id: str, period: str, json_content: str
) -> str:
    drive = get_drive_client(access_token)
    folder_id = get_or_create_receipts_folder_sync(access_token, sheet_id)
    filename = f"analysis_{period}_{today_iso()}.json"
    file = drive.files().create(
        body={"name": filename, "parents": [folder_id]},
        media_body=MediaInMemoryUpload(json_content.encode("utf-8"), mimetype="application/json"),
        fields="id",
    ).execute()
    return file["id"]


async def store_analysis_in_drive(
    access_token: str, sheet_id: str, period: str, json_content: str
) -> str:
    return await asyncio.to_thread(
        _store_analysis_in_drive_sync, access_token, sheet_id, period, json_content
    )


async def get_analysis_from_drive(access_token: str, file_id: str) -> str:
    def work():
        drive = get_drive_client(access_token)
        content: bytes = drive.files().get_media(fileId=file_id).execute()
        return content.decode("utf-8")
    return await asyncio.to_thread(work)


# Return cache entries for multiple periods in one read (used by cron/status)
async def get_analysis_cache_for_periods(
    access_token: str, sheet_id: str, periods: list[str]
) -> dict[str, dict | None]:
    def work():
        rows = _read_rows_sync(access_token, sheet_id)
        result: dict[str, dict | None] = {}
        for period in periods:
            row = next((r for r in rows if _at(r, 1) == period), None)
            result[period] = _row_to_cached_analysis(row) if row else None
        return result
    return await asyncio.to_thread(work)


# Return all cache rows with a given status (used by cron retry)
async def get_analysis_cache_rows_by_status(
    access_token: str, sheet_id: str, status: str
) -> list[dict]:
    def work():
        rows = _read_rows_sync(access_token, sheet_id)
        return [_row_to_cached_analysis(r) for r in rows if _at(r, 5) == status]
    return await asyncio.to_thread(work)


async def save_analysis_cache(
    access_token: str, sheet_id: str, period: str, period_type: str, summary_json: str
) -> None:
    """Store analysis result — large payloads go to Drive, cell holds the pointer."""
    needs_drive = len(summary_json) > ANALYSIS_CELL_LIMIT
    drive_file_id = ""
    cell_json = summary_json

    if needs_drive:
        drive_file_id = await store_analysis_in_drive(access_token, sheet_id, period, summary_json)
        cell_json = ""

    await upsert_analysis_cache_row(
        access_token, sheet_id, period, period_type, "done", cell_json, drive_file_id
    )

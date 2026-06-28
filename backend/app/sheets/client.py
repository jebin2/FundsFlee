"""Google API clients — port of src/lib/sheets/client.ts.

google-api-python-client is blocking; call these through asyncio.to_thread
(or the run_sheets helper below) from async routes.
"""
import asyncio
import time
from collections.abc import Callable
from typing import Any, TypeVar

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.core.logger import log

T = TypeVar("T")


def _creds(access_token: str) -> Credentials:
    return Credentials(token=access_token)


def get_sheets_client(access_token: str):
    return build("sheets", "v4", credentials=_creds(access_token), cache_discovery=False)


def get_drive_client(access_token: str):
    return build("drive", "v3", credentials=_creds(access_token), cache_discovery=False)


def get_gmail_client(access_token: str):
    return build("gmail", "v1", credentials=_creds(access_token), cache_discovery=False)


# Retry wrapper for Sheets API calls — handles 429 (rate limit) and transient 5xx.
# Quota (429) waits 65s to let the per-minute window reset; 5xx uses exponential backoff.
def with_sheets_retry(fn: Callable[[], T], max_retries: int = 3) -> T:
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except HttpError as err:
            status = err.resp.status if err.resp else 0
            is_quota = status == 429
            is_transient = status in (500, 503)
            if (is_quota or is_transient) and attempt < max_retries:
                delay = 65.0 if is_quota else float(2**attempt)
                log.warn("sheets", f"retry {attempt + 1}/{max_retries}", {"status": status, "delayMs": int(delay * 1000)})
                time.sleep(delay)
                continue
            raise
    raise RuntimeError("Unreachable")


async def run_sheets(fn: Callable[[], T]) -> T:
    """Run a blocking Google API call (with retry) off the event loop."""
    return await asyncio.to_thread(with_sheets_retry, fn)


def execute(request: Any) -> Any:
    """Convenience: .execute() a googleapiclient request inside the retry wrapper."""
    return with_sheets_retry(request.execute)

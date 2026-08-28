"""Meta tab (key/value).

Every write used to read meta!A2:A100 first to find the key's row, so saving
four settings cost eight requests against a 60-reads-per-minute quota — and
none of it went through the retry wrapper, so a 429 surfaced as a 500 instead
of backing off. Both halves are local now; the syncer sends the changed rows.
"""
import asyncio

from app.db import mirror


def _get_meta_values_sync(access_token: str, sheet_id: str) -> dict[str, str]:
    rows = mirror.rows(access_token, sheet_id, "meta")
    return {r[0]: (r[1] if len(r) > 1 and r[1] is not None else "") for r in rows if r and r[0]}


async def get_meta_values(access_token: str, sheet_id: str) -> dict[str, str]:
    return await asyncio.to_thread(_get_meta_values_sync, access_token, sheet_id)


def _set_meta_values_sync(access_token: str, sheet_id: str, values: dict[str, str]) -> None:
    if not values:
        return

    # Which keys already have a row. An existing key is an update in place; a
    # new one appends, so the mirror keeps the sheet's row order.
    rows = mirror.rows(access_token, sheet_id, "meta")
    existing = {r[0] for r in rows if r and r[0]}

    for k, v in values.items():
        if k in existing:
            mirror.update(access_token, sheet_id, "meta", {"value": v}, key=k)
    mirror.append(access_token, sheet_id, "meta",
                  [{"key": k, "value": v} for k, v in values.items()
                   if k not in existing])


async def set_meta_values(access_token: str, sheet_id: str, values: dict[str, str]) -> None:
    """Write several keys at once. Prefer this over looping."""
    await asyncio.to_thread(_set_meta_values_sync, access_token, sheet_id, values)


async def set_meta_value(access_token: str, sheet_id: str, key: str, value: str) -> None:
    await asyncio.to_thread(_set_meta_values_sync, access_token, sheet_id, {key: value})

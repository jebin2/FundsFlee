"""Duplicate detection — port of src/lib/ai/dedup.ts.

Same-day comparison (window_days=0) is the ported behaviour and stays exactly
as it was. A window widens the comparison to ±N days, which matters for cards:
the bank alert carries the transaction date while the statement carries the
posting date, often 1–3 days later, so the same payment lands on two different
dates and a same-day join would never see it.
"""
import json
from datetime import date, timedelta

from app.ai.client import generate_text
from app.ai.parse_json import try_parse_ai_json
from app.core.logger import log

# A backfill spanning years would otherwise make one sequential AI call per
# date. Bounded so an import cannot turn into an hours-long scan; anything past
# this is picked up by the daily whole-sheet pass.
MAX_AI_CALLS = 40


def _as_date(value) -> date | None:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def _payload(txs: list[dict], with_date: bool) -> str:
    rows = []
    for t in txs:
        row = {
            "id": t["id"],
            "merchant": t["merchant"],
            "item_name": t.get("item_name") or "",
            "amount": t["amount"],
            "source": t.get("source"),
            "notes": t.get("notes") or "",
        }
        if with_date:
            # Only meaningful once the window spans more than one day.
            row["date"] = t.get("date") or ""
        rows.append(row)
    return json.dumps(rows, separators=(",", ":"), ensure_ascii=False)


def _same_day_prompt(date_key: str, payload: str) -> str:
    return f"""Find duplicate transactions within this single day: {date_key}

Transactions (id, merchant, item_name, amount, source, notes):
{payload}

A duplicate means the same real-world payment recorded more than once (e.g. from both a receipt scan and a bank email, or from two bank alerts for the same UPI transaction).

Rules:
1. Same merchant (fuzzy — "OPEN MART" = "OPENMART") AND same amount → duplicate.
2. Same merchant AND amount within ₹30 AND one source is "email" or "shortcut" → likely duplicate (bank alert may show net amount while payment app shows gross).
3. Notes contain the same UPI ref / bank ref number → duplicate regardless of merchant spelling or minor amount difference.
4. item_name is often empty for email imports — do NOT require matching item_name for cross-source duplicates.
5. "Unknown" merchant with amount=0 → NOT a duplicate unless notes match.
6. Pick the entry with the most detail (receipt > email > shortcut) as original_id; if equal, pick earliest time.
7. Return [] if no duplicates found.

Respond with JSON only:
[{{"original_id":"...","duplicate_ids":["..."],"reason":"..."}}]"""


def _windowed_prompt(start: str, end: str, payload: str) -> str:
    return f"""Find duplicate transactions in this date range: {start} to {end}

Transactions (id, date, merchant, item_name, amount, source, notes):
{payload}

A duplicate means the same real-world payment recorded more than once (e.g. from both a receipt scan and a bank email, from two bank alerts for the same UPI transaction, or from a bank alert and the monthly statement that lists it).

Rules:
1. Same merchant (fuzzy — "OPEN MART" = "OPENMART") AND same amount → duplicate.
2. Same merchant AND amount within ₹30 AND one source is "email" or "shortcut" → likely duplicate (bank alert may show net amount while payment app shows gross).
3. Notes contain the same UPI ref / bank ref number → duplicate regardless of merchant spelling or minor amount difference.
4. Dates need NOT match. A card payment shows the transaction date in a bank alert but the posting date on a statement, 1-3 days later. Same merchant and amount a day or two apart is ONE payment, not two.
5. Genuinely repeated spend is NOT a duplicate — the same merchant and amount on different dates can be a real subscription or a daily commute. Treat it as duplicate only when the sources differ (one is a statement or bank alert of the other) or a reference number matches.
6. item_name is often empty for email imports — do NOT require matching item_name for cross-source duplicates.
7. "Unknown" merchant with amount=0 → NOT a duplicate unless notes match.
8. Pick the entry with the most detail (receipt > email > shortcut) as original_id; if equal, pick earliest date and time.
9. Return [] if no duplicates found.

Respond with JSON only:
[{{"original_id":"...","duplicate_ids":["..."],"reason":"..."}}]"""


async def find_duplicates(
    transactions: list[dict],
    window_days: int = 0,
    focus_ids: set[str] | None = None,
) -> list[dict]:
    """One AI call per candidate window.

    focus_ids narrows which windows are built to those anchored on a row the
    caller cares about — after an import, the rows just written. Every other
    pair in the range is old-against-old and was already scanned on the run
    that introduced it, so re-asking about it costs a call and can only
    reproduce an existing verdict. Omit it for a full sweep.
    """
    # Group by date — only dates with 2+ transactions can have duplicates
    by_date: dict[str, list[dict]] = {}
    for tx in transactions:
        by_date.setdefault(tx["date"], []).append(tx)

    results: list[dict] = []
    claimed: set[str] = set()   # a row is somebody's duplicate only once
    called: set[frozenset] = set()  # overlapping windows repeat candidate sets

    dates = sorted(by_date)
    if focus_ids:
        # The ±window around each anchor still pulls in its neighbours, so a new
        # row on the 5th is compared against an old one on the 7th.
        dates = sorted({t["date"] for t in transactions
                        if t.get("id") in focus_ids and t.get("date")})

    for date_key in dates:
        if window_days > 0:
            focus = _as_date(date_key)
            if focus is None:
                continue
            lo, hi = focus - timedelta(days=window_days), focus + timedelta(days=window_days)
            lo_iso, hi_iso = lo.isoformat(), hi.isoformat()
            txs = [t for t in transactions if lo_iso <= (t.get("date") or "") <= hi_iso]
        else:
            txs = by_date[date_key]

        if len(txs) < 2:
            continue

        fingerprint = frozenset(t["id"] for t in txs)
        if fingerprint in called:
            continue
        if len(called) >= MAX_AI_CALLS:
            log.warn("dedup", f"stopped after {MAX_AI_CALLS} AI calls — "
                              "the rest of the range was not scanned",
                     {"datesLeft": len(dates) - dates.index(date_key)})
            break
        called.add(fingerprint)

        payload = _payload(txs, with_date=window_days > 0)
        prompt = (_windowed_prompt(lo_iso, hi_iso, payload) if window_days > 0
                  else _same_day_prompt(date_key, payload))

        # No try/except: callers distinguish an AI outage from "no duplicates"
        # (duplicate_detection_service._is_ai_unavailable_error), so failures
        # must propagate.
        raw = await generate_text(prompt, "", 768)

        groups = try_parse_ai_json(raw, "array")
        if not groups:
            continue

        for group in groups:
            if not isinstance(group, dict):
                continue
            dups = [d for d in (group.get("duplicate_ids") or []) if d not in claimed]
            if not dups:
                continue
            claimed.update(dups)
            results.append({**group, "duplicate_ids": dups})

    if window_days > 0:
        log.info("dedup", "windowed scan complete",
                 {"windowDays": window_days, "aiCalls": len(called),
                  "groups": len(results), "flagged": len(claimed)})
    return results

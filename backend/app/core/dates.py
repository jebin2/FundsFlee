"""Date helpers — port of src/lib/date/iso.ts.

IMPORTANT: dates are SERVER-LOCAL (IST on the VPS), never UTC. Commit
10909bd ("time isse fux") fixed date shifts caused by UTC conversion —
toISODate deliberately uses local date parts.
"""
from datetime import datetime, timezone


def to_iso_date(date: datetime) -> str:
    return date.strftime("%Y-%m-%d")


def today_iso(now: datetime | None = None) -> str:
    return to_iso_date(now or datetime.now())


def now_iso() -> str:
    """JS new Date().toISOString() equivalent: UTC, millisecond precision, Z suffix.
    Used for created_at/updated_at timestamps (those ARE UTC in the sheet)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

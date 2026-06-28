"""Period range helper — port of src/lib/date/periods.ts.

Dates are SERVER-LOCAL (IST), never UTC — see app/core/dates.py.
"""
from datetime import datetime, timedelta

from app.core.dates import to_iso_date


def get_period_range(period: str, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    to = to_iso_date(now)

    if period == "week":
        return {"from": to_iso_date(now - timedelta(days=7)), "to": to, "label": "Last 7 days"}

    if period == "year":
        return {
            "from": to_iso_date(datetime(now.year, 1, 1)),
            "to": to,
            "label": f"Year {now.year}",
        }

    return {
        "from": to_iso_date(datetime(now.year, now.month, 1)),
        "to": to,
        "label": now.strftime("%B %Y"),
    }

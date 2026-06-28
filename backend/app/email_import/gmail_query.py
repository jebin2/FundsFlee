"""Gmail search query builder — port of src/server/email-import/gmailQuery.ts."""
import math
from datetime import datetime


def build_gmail_query(from_contains: list[str], days_back: int, last_run: str | None = None) -> str:
    from_filter = " OR ".join(f"from:{f}" for f in from_contains)
    from_part = f"from:{from_contains[0]}" if len(from_contains) == 1 else f"{{{from_filter}}}"
    if last_run:
        epoch = datetime.fromisoformat(last_run.replace("Z", "+00:00")).timestamp()
        date_part = f"after:{math.floor(epoch)}"
    else:
        date_part = f"newer_than:{days_back}d"
    return f"{from_part} {date_part}"

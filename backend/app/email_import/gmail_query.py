"""Gmail search query builder — port of src/server/email-import/gmailQuery.ts.

Sender and subject terms are OR'd together, not AND'd: a forwarded alert carries
the forwarder's own address, so only its subject identifies it. OR also means
adding a subject filter can only ever widen an existing setup, never silently
filter out mail that used to import.
"""
import math
from datetime import datetime


def _subject_term(value: str) -> str:
    # Quote so multi-word subjects stay one term; strip embedded quotes so a
    # stray one cannot break out and corrupt the query.
    return 'subject:"{}"'.format(value.replace('"', "").strip())


def build_gmail_query(
    from_contains: list[str],
    days_back: int,
    last_run: str | None = None,
    subject_contains: list[str] | None = None,
) -> str:
    terms = [f"from:{f}" for f in from_contains if f]
    terms += [_subject_term(s) for s in (subject_contains or []) if s and s.strip()]

    # One term needs no grouping; Gmail treats {a OR b} as an OR group.
    match_part = terms[0] if len(terms) == 1 else "{" + " OR ".join(terms) + "}"

    if last_run:
        epoch = datetime.fromisoformat(last_run.replace("Z", "+00:00")).timestamp()
        date_part = f"after:{math.floor(epoch)}"
    elif days_back and days_back > 0:
        date_part = f"newer_than:{days_back}d"
    else:
        # 0 means no date limit — search the whole mailbox. Gmail still caps the
        # result set, so this returns the most recent matches rather than every
        # message ever.
        date_part = ""
    return f"{match_part} {date_part}".strip()

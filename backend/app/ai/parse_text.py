"""Text entry point — SMS, pasted text, iOS Shortcut input.

Builds a text unit and hands it to the single parser. No prompt of its own.
"""
from app.ai.parser import NO_FLOOR, parse_units, text_unit
from app.core.dates import today_iso


async def parse_transaction_text(
    text: str,
    user_region: str | None = None,
    today_date: str | None = None,
) -> dict:
    """Returns one extracted transaction dict (empty dict when nothing found)."""
    result = await parse_units(
        [text_unit(text)],
        user_region or "",
        today_date or today_iso(),
        # Interactive: hand back whatever was found and let the user correct it,
        # rather than silently rejecting a low-confidence parse.
        min_confidence=NO_FLOOR,
        apply_cheap_guards=False,
    )
    rows = result["transactions"]
    return rows[0] if rows else {}

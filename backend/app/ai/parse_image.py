"""Image entry point — receipt photos and scans.

Builds an image unit and hands it to the single parser. The returned items keep
their prices so receipt_processing_service can expand them into a row each.
"""
from app.ai.parser import NO_FLOOR, image_unit, parse_units
from app.core.dates import today_iso


async def parse_receipt_image(
    image_base64: str,
    media_type: str,
    user_region: str | None = None,
    today_date: str | None = None,
) -> dict:
    result = await parse_units(
        [image_unit(image_base64, media_type)],
        user_region or "",
        today_date or today_iso(),
        # Interactive: hand back what was found and let the user correct it.
        min_confidence=NO_FLOOR,
        apply_cheap_guards=False,
    )
    rows = result["transactions"]
    return rows[0] if rows else {}

"""Receipt image parser — port of src/lib/ai/parse-image.ts."""
from app.ai.client import generate_with_image
from app.ai.parse_json import parse_ai_json
from app.ai.parse_text import SYSTEM_PROMPT
from app.core.dates import today_iso


async def parse_receipt_image(
    image_base64: str,
    media_type: str,
    user_region: str | None = None,
    today_date: str | None = None,
) -> dict:
    user_context = " ".join(
        p for p in [
            f"User is in {user_region}." if user_region else "",
            f"Today's date is {today_date}." if today_date else f"Today's date is {today_iso()}.",
        ] if p
    )

    raw = await generate_with_image(
        image_base64,
        media_type,
        f"{user_context}\n\nParse this receipt and extract every line item.",
        SYSTEM_PROMPT,
        2048,
    )

    return parse_ai_json(raw)

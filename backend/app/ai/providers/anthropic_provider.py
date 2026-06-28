"""Claude provider — port of src/lib/ai/providers/anthropicProvider.ts."""
from anthropic import AsyncAnthropic

from app.config import settings

CLAUDE_MODEL = settings.ai_model or "claude-sonnet-4-6"


def _client() -> AsyncAnthropic:
    return AsyncAnthropic(api_key=settings.anthropic_api_key or None)


async def claude_text(prompt: str, system: str, max_tokens: int) -> str:
    msg = await _client().messages.create(
        model=CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    block = msg.content[0]
    if block.type != "text":
        raise RuntimeError("Unexpected Claude response type")
    return block.text


async def claude_image(
    image_base64: str, mime_type: str, text: str, system: str, max_tokens: int
) -> str:
    msg = await _client().messages.create(
        model=CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": mime_type, "data": image_base64}},
                {"type": "text", "text": text},
            ],
        }],
    )
    block = msg.content[0]
    if block.type != "text":
        raise RuntimeError("Unexpected Claude response type")
    return block.text

"""Gemini provider — port of src/lib/ai/providers/geminiProvider.ts."""
import asyncio
import base64
from collections.abc import Awaitable, Callable
from typing import TypeVar

from google import genai
from google.genai import types as genai_types

from app.config import settings

GEMINI_MODEL = settings.ai_model or "gemini-3-flash-preview"

T = TypeVar("T")


def _client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    return genai.Client(api_key=settings.gemini_api_key)


async def with_gemini_retry(fn: Callable[[], Awaitable[T]], retries: int = 3) -> T:
    for attempt in range(retries + 1):
        try:
            return await fn()
        except Exception as err:
            status = getattr(err, "code", None) or getattr(err, "status_code", None)
            is_retryable = status in (503, 429)
            if is_retryable and attempt < retries:
                await asyncio.sleep(2.0 * (2 ** attempt))
                continue
            raise
    raise RuntimeError("Unreachable")


async def gemini_text(prompt: str, system: str) -> str:
    client = _client()
    result = await with_gemini_retry(lambda: client.aio.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=genai_types.GenerateContentConfig(system_instruction=system),
    ))
    return result.text or ""


async def gemini_image(image_base64: str, mime_type: str, text: str, system: str) -> str:
    client = _client()
    image_part = genai_types.Part.from_bytes(
        data=base64.b64decode(image_base64), mime_type=mime_type
    )
    result = await with_gemini_retry(lambda: client.aio.models.generate_content(
        model=GEMINI_MODEL,
        contents=[image_part, text],
        config=genai_types.GenerateContentConfig(system_instruction=system),
    ))
    return result.text or ""

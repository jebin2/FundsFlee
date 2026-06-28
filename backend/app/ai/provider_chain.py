"""Provider fallback chains — port of src/lib/ai/providerChain.ts."""
import time
from collections.abc import Awaitable, Callable

from app.config import settings
from app.core.logger import log
from app.ai.providers.anthropic_provider import claude_text, claude_image
from app.ai.providers.gemini_provider import gemini_text, gemini_image
from app.ai.providers.opencode_provider import opencode_text
from app.ai.providers.ocr_provider import opencode_image

PRIMARY = (settings.ai_provider or "opencode").lower()

TextFn = Callable[[str, str, int], Awaitable[str]]
ImageFn = Callable[[str, str, str, str, int], Awaitable[str]]


def text_chain() -> list[TextFn]:
    all_fns: list[TextFn] = [
        lambda p, s, t: claude_text(p, s, t),
        lambda p, s, t: gemini_text(p, s),
        lambda p, s, t: opencode_text(p, s),
    ]
    if PRIMARY == "gemini":
        return [all_fns[1], all_fns[0], all_fns[2]]
    if PRIMARY == "opencode":
        return [all_fns[2], all_fns[0], all_fns[1]]
    return all_fns


def image_chain() -> list[ImageFn]:
    claude: ImageFn = lambda b, m, t, s, tok: claude_image(b, m, t, s, tok)
    gemini: ImageFn = lambda b, m, t, s, tok: gemini_image(b, m, t, s)
    opencode: ImageFn = lambda b, m, t, s, tok: opencode_image(b, m, t, s)
    if PRIMARY == "gemini":
        return [gemini, claude, opencode]
    if PRIMARY == "opencode":
        return [opencode, claude, gemini]
    return [claude, gemini, opencode]


async def run_chain(
    chain: list[Callable[[], Awaitable]], label: str, providers: list[str]
):
    last_err: Exception | None = None
    for i, step in enumerate(chain):
        provider = providers[i] if i < len(providers) else f"provider-{i}"
        t0 = time.time()
        try:
            result = await step()
            log.info("ai", f"{label} ok", {"provider": provider, "ms": int((time.time() - t0) * 1000)})
            return result
        except Exception as err:
            last_err = err
            log.warn(
                "ai",
                f"{label} failed — trying next",
                {"provider": provider, "ms": int((time.time() - t0) * 1000), "err": str(err)},
            )
    raise last_err

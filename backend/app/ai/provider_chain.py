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


def _order() -> list[str]:
    """Configured provider first, then the others as fallbacks."""
    if PRIMARY == "gemini":
        return ["gemini", "claude", "opencode"]
    if PRIMARY == "opencode":
        return ["opencode", "claude", "gemini"]
    return ["claude", "gemini", "opencode"]


def _configured(name: str) -> bool:
    """Skip a provider we have no usable credential for.

    Attempting one anyway costs a doomed round-trip per call — roughly half a
    second each for claude and gemini — and buries the real failure under
    401s in the log.  opencode authenticates by URL, so it is always eligible.
    """
    if name == "claude":
        return bool(settings.anthropic_api_key)
    if name == "gemini":
        return bool(settings.gemini_api_key)
    return True


def text_chain() -> list[tuple[str, TextFn]]:
    fns: dict[str, TextFn] = {
        "claude": lambda p, s, t: claude_text(p, s, t),
        "gemini": lambda p, s, t: gemini_text(p, s),
        "opencode": lambda p, s, t: opencode_text(p, s),
    }
    return [(n, fns[n]) for n in _order() if _configured(n)]


def image_chain() -> list[tuple[str, ImageFn]]:
    fns: dict[str, ImageFn] = {
        "claude": lambda b, m, t, s, tok: claude_image(b, m, t, s, tok),
        "gemini": lambda b, m, t, s, tok: gemini_image(b, m, t, s),
        "opencode": lambda b, m, t, s, tok: opencode_image(b, m, t, s),
    }
    return [(n, fns[n]) for n in _order() if _configured(n)]


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

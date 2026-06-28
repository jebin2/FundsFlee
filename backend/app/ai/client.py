"""AI client facade — port of src/lib/ai/client.ts."""
from app.ai.provider_chain import PRIMARY, text_chain, image_chain, run_chain


def _provider_order() -> list[str]:
    if PRIMARY == "gemini":
        return ["gemini", "claude", "opencode"]
    if PRIMARY == "opencode":
        return ["opencode", "claude", "gemini"]
    return ["claude", "gemini", "opencode"]


async def generate_text(prompt: str, system: str, max_tokens: int = 1024) -> str:
    chain = text_chain()
    providers = _provider_order()
    steps = [lambda fn=fn: fn(prompt, system, max_tokens) for fn in chain]
    return await run_chain(steps, "text", providers)


async def generate_with_image(
    image_base64: str,
    mime_type: str,
    text: str,
    system: str,
    max_tokens: int = 2048,
) -> str:
    chain = image_chain()
    providers = _provider_order()
    steps = [lambda fn=fn: fn(image_base64, mime_type, text, system, max_tokens) for fn in chain]
    return await run_chain(steps, "image", providers)


active_provider = PRIMARY

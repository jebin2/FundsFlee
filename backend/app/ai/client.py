"""AI client facade — port of src/lib/ai/client.ts."""
from app.ai.provider_chain import PRIMARY, text_chain, image_chain, run_chain


async def generate_text(prompt: str, system: str, max_tokens: int = 1024) -> str:
    chain = text_chain()
    steps = [lambda fn=fn: fn(prompt, system, max_tokens) for _, fn in chain]
    return await run_chain(steps, "text", [name for name, _ in chain])


async def generate_with_image(
    image_base64: str,
    mime_type: str,
    text: str,
    system: str,
    max_tokens: int = 2048,
) -> str:
    chain = image_chain()
    steps = [lambda fn=fn: fn(image_base64, mime_type, text, system, max_tokens) for _, fn in chain]
    return await run_chain(steps, "image", [name for name, _ in chain])


active_provider = PRIMARY

"""OCR + OpenCode image provider — port of src/lib/ai/providers/ocrProvider.ts.
Extracts text from the image via the HF OCR space, then answers via opencode_text."""
import asyncio
import base64
import json
import time

import httpx

from app.ai.providers.opencode_provider import auth_headers, opencode_text
from app.config import settings


def _base_url() -> str:
    return (settings.ocr_api_url or "https://jebin2-ocr.hf.space").rstrip("/")


async def opencode_image(image_base64: str, mime_type: str, text: str, system: str) -> str:
    base = _base_url()
    async with httpx.AsyncClient(timeout=30.0, headers=auth_headers()) as client:
        upload = await client.post(
            f"{base}/api/tasks/upload",
            files={"image": ("receipt.jpg", base64.b64decode(image_base64), mime_type)},
            data={"hide_from_ui": "true"},
        )
        if upload.status_code >= 400:
            raise RuntimeError(f"OCR upload failed: {upload.status_code}")
        task_id = upload.json().get("id")
        if not task_id:
            raise RuntimeError("OCR upload returned no task ID")

        ocr_text = ""
        deadline = time.monotonic() + 90.0
        while time.monotonic() < deadline:
            await asyncio.sleep(2.0)
            poll = await client.get(f"{base}/api/tasks/{task_id}")
            if poll.status_code >= 400:
                raise RuntimeError(f"OCR poll failed: {poll.status_code}")
            task = poll.json()
            if task.get("status") == "completed":
                try:
                    parsed = json.loads(task.get("result") or "{}")
                    ocr_text = parsed.get("text") or ""
                except (json.JSONDecodeError, TypeError):
                    ocr_text = task.get("result") or ""
                break
            if task.get("status") == "failed":
                raise RuntimeError(f"OCR task failed: {task.get('error')}")

    if not ocr_text:
        raise RuntimeError("OCR returned empty text")

    combined = "\n".join(p for p in [text, "---", "Text extracted from image:", ocr_text] if p)
    return await opencode_text(combined, system)

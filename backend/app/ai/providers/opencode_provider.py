"""OpenCode provider — port of src/lib/ai/providers/opencodeProvider.ts."""
import asyncio
import json
import time

import httpx

from app.config import settings


def _base_url() -> str:
    return (settings.opencode_api_url or "https://opencode.voidall.com").rstrip("/")


async def opencode_text(prompt: str, system: str) -> str:
    base = _base_url()
    async with httpx.AsyncClient(timeout=30.0) as client:
        submit = await client.post(
            f"{base}/api/tasks/upload",
            json={"text": prompt, "system_prompt": system, "model": "opencode"},
        )
        if submit.status_code >= 400:
            raise RuntimeError(f"OpenCode submit failed: {submit.status_code}")
        task_id = submit.json()["id"]

        deadline = time.monotonic() + 420.0
        while time.monotonic() < deadline:
            await asyncio.sleep(3.0)
            poll = await client.get(f"{base}/api/tasks/{task_id}")
            if poll.status_code >= 400:
                raise RuntimeError(f"OpenCode poll failed: {poll.status_code}")
            task = poll.json()
            if task.get("status") == "completed":
                try:
                    result = json.loads(task.get("result") or "")
                except (json.JSONDecodeError, TypeError):
                    raise RuntimeError("OpenCode returned invalid JSON")
                return result.get("response") or ""
            if task.get("status") == "failed":
                raise RuntimeError(f"OpenCode task failed: {task.get('error')}")
    raise RuntimeError("OpenCode task timed out after 420s")

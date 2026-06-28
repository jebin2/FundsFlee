"""Web push notifications — port of src/lib/push.ts (web-push → pywebpush).

Generate VAPID keys once and add to .env.local:
  VAPID_PUBLIC_KEY=...
  VAPID_PRIVATE_KEY=...
  NEXT_PUBLIC_VAPID_PUBLIC_KEY=...  (same public key, for the client)
"""
import asyncio
import json

from pywebpush import webpush, WebPushException

from app.config import settings

_VAPID_CLAIMS = {"sub": "mailto:support@fundsflee.app"}


async def send_push_notification(subscription_json: str, payload: dict) -> None:
    public_key = settings.vapid_public_key or ""
    private_key = settings.vapid_private_key or ""
    if not public_key or not private_key:
        return  # VAPID not configured — skip silently

    try:
        subscription = json.loads(subscription_json)
    except (json.JSONDecodeError, TypeError, ValueError):
        return  # Corrupted subscription stored in meta — skip silently

    def _send() -> None:
        webpush(
            subscription_info=subscription,
            data=json.dumps(payload),
            vapid_private_key=private_key,
            vapid_claims=dict(_VAPID_CLAIMS),
        )

    await asyncio.to_thread(_send)

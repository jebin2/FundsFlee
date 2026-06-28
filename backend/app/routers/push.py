"""Push subscription endpoints — port of src/app/api/push/subscribe/route.ts."""
import json

from fastapi import APIRouter, Depends, Request

from app.core.deps import SheetSession, require_session
from app.sheets import get_meta_values, set_meta_value

router = APIRouter()


@router.post("/api/push/subscribe")
async def subscribe(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    subscription = await request.json()
    await set_meta_value(
        session.access_token, session.sheet_id, "push_subscription",
        json.dumps(subscription, ensure_ascii=False, separators=(",", ":")),
    )
    return {"ok": True}


@router.delete("/api/push/subscribe")
async def unsubscribe(session: SheetSession = Depends(require_session)) -> dict:
    meta = await get_meta_values(session.access_token, session.sheet_id)
    if meta.get("push_subscription"):
        await set_meta_value(session.access_token, session.sheet_id, "push_subscription", "")
    return {"ok": True}

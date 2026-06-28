"""Items endpoints — port of src/app/api/items/*."""
from fastapi import APIRouter, Depends, Request

from app.core.deps import SheetSession, require_session
from app.services.item_normalization_service import request_item_normalization
from app.services.item_suggestion_service import get_pending_suggestions, resolve_pending_suggestion

router = APIRouter()


@router.post("/api/items/normalize")
async def normalize(session: SheetSession = Depends(require_session)) -> dict:
    return await request_item_normalization(session)


@router.get("/api/items/suggestions")
async def suggestions_get(session: SheetSession = Depends(require_session)) -> dict:
    suggestions = await get_pending_suggestions(session)
    return {"suggestions": suggestions}


@router.patch("/api/items/suggestions")
async def suggestions_patch(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    await resolve_pending_suggestion(session, await request.json())
    return {"ok": True}

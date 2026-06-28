"""Categories endpoints — port of src/app/api/categories/*."""
from fastapi import APIRouter, Depends, Request

from app.core.deps import SheetSession, require_session
from app.sheets import append_category, delete_category_by_id, get_categories

router = APIRouter()


@router.get("/api/categories")
async def list_categories(session: SheetSession = Depends(require_session)) -> dict:
    categories = await get_categories(session.access_token, session.sheet_id)
    return {"categories": categories}


@router.post("/api/categories")
async def create_category(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    cat = await request.json()
    await append_category(session.access_token, session.sheet_id, cat)
    return {"ok": True}


@router.delete("/api/categories/{cat_id}")
async def delete_category(cat_id: str, session: SheetSession = Depends(require_session)) -> dict:
    await delete_category_by_id(session.access_token, session.sheet_id, cat_id)
    return {"ok": True}

"""Sheet endpoints — /api/sheet/init and /api/reset (ports of those routes)."""
from fastapi import APIRouter, Depends

from app.core.deps import SheetSession, require_session
from app.sheets import reset_sheet

router = APIRouter()


# Sheet is already initialized during sign-in (auth callback).
# This endpoint just tells the client whether this is a new user.
@router.post("/api/sheet/init")
async def sheet_init(session: SheetSession = Depends(require_session)) -> dict:
    sheet_url = f"https://docs.google.com/spreadsheets/d/{session.sheet_id}/edit"
    return {"sheetId": session.sheet_id, "sheetUrl": sheet_url, "isNew": False}


@router.post("/api/reset")
async def reset(session: SheetSession = Depends(require_session)) -> dict:
    await reset_sheet(session.access_token, session.sheet_id)
    return {"ok": True}

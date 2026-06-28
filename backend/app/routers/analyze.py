"""Analysis endpoints — port of src/app/api/analyze/route.ts."""
from fastapi import APIRouter, Depends, Request

from app.core.deps import SheetSession, require_session
from app.services.analysis_service import get_analysis_status, request_analysis

router = APIRouter()


@router.get("/api/analyze")
async def analyze_get(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    period = request.query_params.get("period") or "month"
    return await get_analysis_status(session, period)


@router.post("/api/analyze")
async def analyze_post(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    body = await request.json()
    return await request_analysis(session, {
        "period": body.get("period", "month"),
        "region": body.get("region"),
        "lifestyle_tags": body.get("lifestyle_tags"),
        "force_refresh": body.get("force_refresh"),
    })

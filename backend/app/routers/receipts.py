"""Receipt endpoints — port of src/app/api/receipts/*."""
from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.deps import SheetSession, require_session
from app.services.receipt_processing_service import process_receipt
from app.use_cases.create_receipt_upload_request import create_receipt_upload_request

router = APIRouter()


@router.post("/api/receipts/upload")
async def upload_receipt(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    form = await request.form()
    image = form.get("image")
    if not image:
        raise HTTPException(status_code=400, detail="image required")
    mime_type = image.content_type or "image/jpeg"
    buffer = await image.read()
    return await create_receipt_upload_request(session, buffer, mime_type)


@router.post("/api/receipts/process")
async def process(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    body = await request.json()
    tx_id = body.get("txId")
    if not tx_id:
        raise HTTPException(status_code=400, detail="txId required")
    receipt = await process_receipt(session, {"txId": tx_id, "region": body.get("region")})
    if "error" in receipt:
        raise HTTPException(status_code=receipt["status"], detail=receipt["error"])
    return receipt

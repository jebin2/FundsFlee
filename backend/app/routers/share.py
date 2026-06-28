"""PWA share-target endpoint — port of src/app/api/share/route.ts.

Must ALWAYS return a redirect (browsers treat non-redirect responses from a
share target as an error), so it resolves the session manually instead of using
the require_session dependency (which would 401).
"""
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from app.core.deps import require_session
from app.use_cases.create_receipt_upload_request import create_receipt_upload_request

router = APIRouter()


@router.post("/api/share")
async def share(request: Request):
    try:
        session = await require_session(request)
    except HTTPException:
        return RedirectResponse("/?share=auth_required", status_code=302)

    form = await request.form()
    text = form.get("text") or ""
    url = form.get("url") or ""
    image = form.get("image")

    if image and hasattr(image, "read"):
        buffer = await image.read()
        if len(buffer) > 0:
            try:
                await create_receipt_upload_request(session, buffer, image.content_type or "image/jpeg")
            except Exception:
                pass  # Best-effort — still redirect to transactions
            return RedirectResponse("/transactions?shared_receipt=1", status_code=302)

    shared_text = text or url
    if shared_text:
        return RedirectResponse(f"/capture?tab=paste&text={quote(shared_text)}", status_code=302)

    return RedirectResponse("/capture", status_code=302)

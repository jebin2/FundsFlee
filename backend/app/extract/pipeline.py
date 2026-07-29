"""Recursive artifact walker — flattens anything attached to a message into the
units the AI chains already accept.

Gmail hands us a message whose attachments may be PDFs, images, or forwarded
message/rfc822 parts that carry their own attachments. This walks that tree once
and returns a flat list, so no caller has to recurse or track depth itself.

Nothing here raises: a bad artifact becomes an "error" unit so one broken
attachment can't fail a whole import run.
"""
import base64

from app.ai.parse_email import extract_email_text
from app.core.logger import log
from app.extract.eml import parse_eml
from app.extract.pdf import PAGE_IMAGE_MIME, PdfError, extract_pdf

# message → forwarded message → that message's attachments. Deeper than this is
# a mail loop, not a bank alert.
MAX_DEPTH = 2
MAX_UNITS = 20
MAX_BYTES = 20 * 1024 * 1024

PDF_MIME = "application/pdf"
EML_MIME = "message/rfc822"
# Mirrors receipt_processing_service.VALID_RECEIPT_MIME_TYPES — kept local so
# the extractors stay independent of the service layer.
IMAGE_MIMES = ("image/jpeg", "image/png", "image/webp")


def _error(source: str, reason: str) -> dict:
    return {"kind": "error", "source": source, "reason": reason}


def _base_mime(mime_type: str) -> str:
    return (mime_type or "").split(";")[0].strip().lower()


async def _walk(data: bytes, mime_type: str, source: str, depth: int, budget: dict) -> list[dict]:
    if not data:
        return []
    if budget["units"] >= MAX_UNITS:
        return []
    if len(data) > MAX_BYTES:
        return [_error(source, "Attachment is larger than 20MB — skipped.")]

    mime = _base_mime(mime_type)

    if mime == EML_MIME:
        return await _walk_eml(data, source, depth, budget)
    if mime == PDF_MIME:
        return _take(budget, [await _pdf_unit(data, source)])
    if mime in IMAGE_MIMES:
        return _take(budget, [{
            "kind": "images",
            "pages": [_b64(data)],
            "mime": mime,
            "source": source,
        }])
    return []  # anything else (calendar invites, signatures, .zip) is ignored


def _take(budget: dict, units: list[dict]) -> list[dict]:
    budget["units"] += len(units)
    return units


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


async def _pdf_unit(data: bytes, source: str) -> dict:
    try:
        out = await extract_pdf(data)
    except PdfError as err:
        # Encrypted or unreadable — surface the message, don't kill the run.
        log.warn("extract", "pdf skipped", {"source": source, "reason": str(err)})
        return _error(source, str(err))

    if out["kind"] == "text":
        return {"kind": "document", "text": out["text"], "source": source,
                "page_count": out["page_count"], "truncated": out["truncated"]}
    return {"kind": "images", "pages": out["pages"], "mime": PAGE_IMAGE_MIME,
            "source": source, "page_count": out["page_count"], "truncated": out["truncated"]}


async def _walk_eml(data: bytes, source: str, depth: int, budget: dict) -> list[dict]:
    if depth >= MAX_DEPTH:
        return [_error(source, "Forwarded message nested too deeply — skipped.")]

    parsed = await parse_eml(data)
    units: list[dict] = []

    body = extract_email_text(parsed["body_text"], parsed["body_mime"])
    if body:
        units.extend(_take(budget, [{
            "kind": "email",
            "text": body,
            "from": parsed["from"],
            "subject": parsed["subject"],
            "date": parsed["date"],
            "source": source,
        }]))

    for att in parsed["attachments"]:
        if budget["units"] >= MAX_UNITS:
            break
        units.extend(await _walk(att["data"], att["mime_type"], att["filename"] or source,
                                 depth + 1, budget))
    return units


async def collect_units(data: bytes, mime_type: str, source: str = "") -> list[dict]:
    """Flatten one artifact into parseable units.

    Unit shapes:
      {"kind": "email",    text, from, subject, date, source}
      {"kind": "document", text, source, page_count, truncated}
      {"kind": "images",   pages[b64], mime, source, ...}
      {"kind": "error",    source, reason}
    """
    return await _walk(data, mime_type, source, depth=0, budget={"units": 0})

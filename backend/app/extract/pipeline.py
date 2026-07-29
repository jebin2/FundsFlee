"""Recursive artifact walker — flattens anything attached to a message into the
units the AI chains already accept.

Gmail hands us a message whose attachments may be PDFs, images, or forwarded
message/rfc822 parts that carry their own attachments. This walks that tree once
and returns a flat list, so no caller has to recurse or track depth itself.

Nothing here raises: a bad artifact becomes an "error" unit so one broken
attachment can't fail a whole import run.

Logging deliberately records sizes, types and decisions — never body text,
document text, names or addresses — so pm2 logs stay shareable for debugging.
"""
import base64
import time

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


def _label(source: str) -> str:
    return source or "(unnamed)"


async def _walk(data: bytes, mime_type: str, source: str, depth: int, budget: dict) -> list[dict]:
    mime = _base_mime(mime_type)

    if not data:
        log.warn("extract", "empty artifact — skipped", {"source": _label(source), "mime": mime})
        return []
    if budget["units"] >= MAX_UNITS:
        log.warn("extract", "unit budget reached — remaining attachments skipped",
                 {"max": MAX_UNITS, "source": _label(source)})
        return []
    if len(data) > MAX_BYTES:
        log.warn("extract", "attachment over size cap — skipped",
                 {"source": _label(source), "mime": mime, "bytes": len(data), "maxBytes": MAX_BYTES})
        return [_error(source, "Attachment is larger than 20MB — skipped.")]

    if mime == EML_MIME:
        return await _walk_eml(data, source, depth, budget)
    if mime == PDF_MIME:
        return _take(budget, [await _pdf_unit(data, source)])
    if mime in IMAGE_MIMES:
        log.info("extract", "image attachment",
                 {"source": _label(source), "mime": mime, "bytes": len(data), "depth": depth})
        return _take(budget, [{
            "kind": "images",
            "pages": [base64.b64encode(data).decode()],
            "mime": mime,
            "source": source,
        }])

    log.info("extract", "unsupported attachment type — ignored",
             {"source": _label(source), "mime": mime, "bytes": len(data)})
    return []


def _take(budget: dict, units: list[dict]) -> list[dict]:
    budget["units"] += len(units)
    return units


async def _pdf_unit(data: bytes, source: str) -> dict:
    t0 = time.time()
    try:
        out = await extract_pdf(data)
    except PdfError as err:
        # Encrypted or unreadable — surface the message, don't kill the run.
        log.warn("extract", "pdf unreadable — skipped",
                 {"source": _label(source), "bytes": len(data), "reason": str(err)})
        return _error(source, str(err))

    common = {
        "source": _label(source),
        "bytes": len(data),
        "pages": out["page_count"],
        "charsPerPage": out["chars_per_page"],
        "truncated": out["truncated"],
        "ms": int((time.time() - t0) * 1000),
    }

    if out["kind"] == "text":
        log.info("extract", "pdf → text layer", {**common, "chars": len(out["text"])})
        return {"kind": "document", "text": out["text"], "source": source,
                "page_count": out["page_count"], "truncated": out["truncated"]}

    # Below the text threshold: scanned or photographed, so it costs vision tokens.
    log.info("extract", "pdf → rasterised (no text layer)",
             {**common, "rendered": len(out["pages"])})
    return {"kind": "images", "pages": out["pages"], "mime": PAGE_IMAGE_MIME,
            "source": source, "page_count": out["page_count"], "truncated": out["truncated"]}


async def _walk_eml(data: bytes, source: str, depth: int, budget: dict) -> list[dict]:
    if depth >= MAX_DEPTH:
        log.warn("extract", "forwarded message nested too deeply — skipped",
                 {"source": _label(source), "depth": depth, "maxDepth": MAX_DEPTH})
        return [_error(source, "Forwarded message nested too deeply — skipped.")]

    parsed = await parse_eml(data)
    units: list[dict] = []

    body = extract_email_text(parsed["body_text"], parsed["body_mime"])
    attachments = parsed["attachments"]

    log.info("extract", "email opened", {
        "source": _label(source),
        "depth": depth,
        "from": parsed["from"][:80],
        "bodyMime": parsed["body_mime"],
        "bodyChars": len(body),
        "rawBodyChars": len(parsed["body_text"]),
        "attachments": len(attachments),
        "types": ",".join(sorted({_base_mime(a["mime_type"]) for a in attachments})) or "-",
    })

    if body:
        units.extend(_take(budget, [{
            "kind": "email",
            "text": body,
            "from": parsed["from"],
            "subject": parsed["subject"],
            "date": parsed["date"],
            "source": source,
        }]))
    else:
        log.warn("extract", "email body empty after cleaning",
                 {"source": _label(source), "rawBodyChars": len(parsed["body_text"])})

    for att in attachments:
        if budget["units"] >= MAX_UNITS:
            log.warn("extract", "unit budget reached — remaining attachments skipped",
                     {"max": MAX_UNITS})
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
    t0 = time.time()
    log.info("extract", "start", {
        "source": _label(source), "mime": _base_mime(mime_type), "bytes": len(data or b""),
    })

    units = await _walk(data, mime_type, source, depth=0, budget={"units": 0})

    counts: dict[str, int] = {}
    for u in units:
        counts[u["kind"]] = counts.get(u["kind"], 0) + 1
    log.info("extract", "done", {
        "source": _label(source),
        "units": len(units),
        "breakdown": ",".join(f"{k}={v}" for k, v in sorted(counts.items())) or "none",
        "ms": int((time.time() - t0) * 1000),
    })
    return units

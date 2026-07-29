"""Recursive artifact walker — flattens anything attached to a message into the
units the AI chains already accept.

Gmail hands us a message whose attachments may be PDFs, images, or forwarded
message/rfc822 parts that carry their own attachments. This walks that tree once
and returns a flat list, so no caller has to recurse or track depth itself.

Units carry a "group": everything describing ONE payment shares a group, and
each forwarded message starts a new one. That distinction is load-bearing. A
Zomato order is a body plus three component invoices — one group, merged into
one transaction. A mail forwarding ten bank alerts is ten separate payments —
ten groups, ten transactions. Putting them in one group would collapse all ten
into a single row and silently lose nine payments.

Nothing here raises: a bad artifact becomes an "error" unit so one broken
attachment can't fail a whole import run.

Logging records sizes, types and decisions — never body text, document text,
names or addresses — so pm2 logs stay shareable.
"""
import base64
import time

from app.ai.parse_email import extract_email_text
from app.core.logger import log
from app.extract.eml import parse_eml
from app.extract.pdf import PAGE_IMAGE_MIME, PdfError, extract_pdf

# Gmail message → forwarded message → that message's attachments. Deeper than
# this is a mail loop, not a bank alert.
MAX_DEPTH = 2
# Groups are what cost money — one AI call each — so that is the real limit.
MAX_GROUPS = 60
# Units are only a runaway guard. It must stay well clear of MAX_GROUPS times a
# typical group size (a Zomato order is 1 email + 3 invoices), because a group
# truncated halfway is worse than one skipped: the model would price an order
# from whichever invoices happened to fit.
MAX_UNITS = 500

PDF_MIME = "application/pdf"
EML_MIME = "message/rfc822"
# Mirrors receipt_processing_service.VALID_RECEIPT_MIME_TYPES — kept local so
# the extractors stay independent of the service layer.
IMAGE_MIMES = ("image/jpeg", "image/png", "image/webp")


def _new_budget() -> dict:
    return {"units": 0, "next_group": 0, "dropped": 0}


def _error(source: str, reason: str, group: int) -> dict:
    return {"kind": "error", "source": source, "reason": reason, "group": group}


def _base_mime(mime_type: str) -> str:
    return (mime_type or "").split(";")[0].strip().lower()


def _label(source: str) -> str:
    return source or "(unnamed)"


def _take(budget: dict, units: list[dict], group: int) -> list[dict]:
    budget["units"] += len(units)
    return [{**u, "group": group} for u in units]


async def _walk(data: bytes, mime_type: str, source: str, depth: int,
                budget: dict, group: int) -> list[dict]:
    mime = _base_mime(mime_type)

    if not data:
        log.warn("extract", "empty artifact — skipped", {"source": _label(source), "mime": mime})
        return []
    if len(data) > _MAX_BYTES:
        log.warn("extract", "attachment over size cap — skipped",
                 {"source": _label(source), "mime": mime, "bytes": len(data), "maxBytes": _MAX_BYTES})
        return [_error(source, "Attachment is larger than 20MB — skipped.", group)]

    if mime == EML_MIME:
        return await _walk_eml(data, source, depth, budget)
    if mime == PDF_MIME:
        return _take(budget, [await _pdf_unit(data, source, group)], group)
    if mime in IMAGE_MIMES:
        log.info("extract", "image attachment",
                 {"source": _label(source), "mime": mime, "bytes": len(data), "depth": depth})
        return _take(budget, [{
            "kind": "images",
            "pages": [base64.b64encode(data).decode()],
            "mime": mime,
            "source": source,
        }], group)

    log.info("extract", "unsupported attachment type — ignored",
             {"source": _label(source), "mime": mime, "bytes": len(data)})
    return []


_MAX_BYTES = 20 * 1024 * 1024


async def _pdf_unit(data: bytes, source: str, group: int) -> dict:
    t0 = time.time()
    try:
        out = await extract_pdf(data)
    except PdfError as err:
        # Encrypted or unreadable — surface the message, don't kill the run.
        log.warn("extract", "pdf unreadable — skipped",
                 {"source": _label(source), "bytes": len(data), "reason": str(err)})
        return _error(source, str(err), group)

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
    # Capacity is checked here, at the group boundary, so a message is taken
    # whole or not at all. Dropping one forwarded order loses one transaction;
    # truncating one silently changes its amount.
    if budget["next_group"] >= MAX_GROUPS or budget["units"] >= MAX_UNITS:
        log.warn("extract", "capacity reached — forwarded message skipped entirely", {
            "source": _label(source), "groups": budget["next_group"],
            "maxGroups": MAX_GROUPS, "units": budget["units"], "maxUnits": MAX_UNITS,
        })
        budget["dropped"] = budget.get("dropped", 0) + 1
        return []

    # A forwarded message is a payment of its own — new group.
    group = budget["next_group"]
    budget["next_group"] += 1

    if depth >= MAX_DEPTH:
        log.warn("extract", "forwarded message nested too deeply — skipped",
                 {"source": _label(source), "depth": depth, "maxDepth": MAX_DEPTH})
        return [_error(source, "Forwarded message nested too deeply — skipped.", group)]

    parsed = await parse_eml(data)
    units: list[dict] = []

    body = extract_email_text(parsed["body_text"], parsed["body_mime"])
    attachments = parsed["attachments"]

    log.info("extract", "email opened", {
        "source": _label(source),
        "group": group,
        "depth": depth,
        "from": parsed["from"][:80],
        "bodyMime": parsed["body_mime"],
        "bodyChars": len(body),
        "rawBodyChars": len(parsed["body_text"]),
        "attachments": len(attachments),
        "types": ",".join(sorted({_base_mime(a["mime_type"]) for a in attachments})) or "-",
    })

    # Always emit the email unit: a statement mail is often just a subject line
    # plus the attachment, and From/Subject are real signal.
    units.extend(_take(budget, [{
        "kind": "email",
        "text": body,
        "from": parsed["from"],
        "subject": parsed["subject"],
        "date": parsed["date"],
        "source": source,
    }], group))

    for att in attachments:
        # No budget check here on purpose: once a group is started it is
        # completed, so an order is never priced from a partial set of invoices.
        # Capacity is decided up front, at the group boundary.
        units.extend(await _walk(att["data"], att["mime_type"], att["filename"] or source,
                                 depth + 1, budget, group))
    return units


def group_units(units: list[dict]) -> list[list[dict]]:
    """Split a flat unit list into per-payment groups, in first-seen order."""
    groups: dict[int, list[dict]] = {}
    for u in units:
        groups.setdefault(u.get("group", 0), []).append(u)
    return [groups[k] for k in sorted(groups)]


def _summarise(units: list[dict], source: str, t0: float, budget: dict) -> None:
    counts: dict[str, int] = {}
    for u in units:
        counts[u["kind"]] = counts.get(u["kind"], 0) + 1
    dropped = budget.get("dropped", 0)
    log.info("extract", "done", {
        "source": _label(source),
        "units": len(units),
        "groups": len({u.get("group", 0) for u in units}),
        "breakdown": ",".join(f"{k}={v}" for k, v in sorted(counts.items())) or "none",
        "ms": int((time.time() - t0) * 1000),
    })
    if dropped:
        log.warn("extract", "forwarded messages dropped at capacity — RAISE MAX_GROUPS",
                 {"source": _label(source), "dropped": dropped, "maxGroups": MAX_GROUPS})


async def collect_units(data: bytes, mime_type: str, source: str = "") -> list[dict]:
    """Flatten one artifact into parseable units.

    Unit shapes (all carry "group"):
      {"kind": "email",    text, from, subject, date, source}
      {"kind": "document", text, source, page_count, truncated}
      {"kind": "images",   pages[b64], mime, source, ...}
      {"kind": "error",    source, reason}
    """
    t0 = time.time()
    log.info("extract", "start", {
        "source": _label(source), "mime": _base_mime(mime_type), "bytes": len(data or b""),
    })
    budget = _new_budget()
    units = await _walk(data, mime_type, source, 0, budget, group=0)
    _summarise(units, source, t0, budget)
    return units


async def collect_message_units(email_unit: dict, attachments: list[dict],
                                source: str = "") -> list[dict]:
    """Units for one Gmail message: its body plus every attachment.

    The body and any directly-attached documents share group 0 — they describe
    the same payment. Each forwarded message inside gets its own group.
    """
    t0 = time.time()
    log.info("extract", "start", {"source": _label(source), "mime": "gmail/message",
                                  "attachments": len(attachments)})

    budget = _new_budget()
    budget["next_group"] = 1  # group 0 belongs to the outer message
    units: list[dict] = [{**email_unit, "group": 0}]

    for att in attachments:
        units.extend(await _walk(att["data"], att["mime_type"], att["filename"] or source,
                                 1, budget, group=0))

    _summarise(units, source, t0, budget)
    return units

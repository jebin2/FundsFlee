"""Gmail attachment discovery and download.

messages().get(format="full") returns the MIME tree with an attachmentId per
attachment but never the bytes, so each one needs a second API call. Only the
types the extractors can actually use are fetched — downloading a 3MB signature
image to throw it away costs quota for nothing.
"""
import asyncio
import base64

from app.core.logger import log

SUPPORTED_MIMES = (
    "application/pdf",
    "message/rfc822",
    "image/jpeg",
    "image/png",
    "image/webp",
)
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
# A bank alert has one statement attached; a marketing mail can have a dozen
# tracking images. Past this many, the message is not what we are looking for.
MAX_ATTACHMENTS_PER_MESSAGE = 5


def _base_mime(mime_type: str) -> str:
    return (mime_type or "").split(";")[0].strip().lower()


def collect_attachment_parts(payload: dict | None) -> list[dict]:
    """Flatten the MIME tree into attachment descriptors.

    A part is an attachment when it carries an attachmentId, or has a filename
    with inline data (Gmail inlines very small parts). Taking a part and also
    recursing into it would double-count a forwarded message, so it is one or
    the other.
    """
    found: list[dict] = []

    def walk(part: dict | None) -> None:
        p = part or {}
        body = p.get("body") or {}
        mime = _base_mime(p.get("mimeType") or "")
        filename = p.get("filename") or ""

        is_attachment = bool(body.get("attachmentId")) or bool(filename and body.get("data"))
        if is_attachment and not mime.startswith("multipart"):
            found.append({
                "filename": filename,
                "mime_type": mime,
                "attachment_id": body.get("attachmentId") or "",
                "inline_data": body.get("data") or "",
                "size": body.get("size") or 0,
            })
            return  # taken — do not also walk its children

        for sub in p.get("parts") or []:
            walk(sub)

    walk(payload)
    return found


def _decode(data: str) -> bytes:
    s = data.replace("-", "+").replace("_", "/")
    return base64.b64decode(s + "=" * (-len(s) % 4))


async def fetch_attachments(gmail, message_id: str, payload: dict | None) -> list[dict]:
    """Returns [{filename, mime_type, data}] for the supported attachments."""
    parts = collect_attachment_parts(payload)
    if not parts:
        return []

    supported = [p for p in parts if p["mime_type"] in SUPPORTED_MIMES]
    if len(supported) < len(parts):
        skipped = sorted({p["mime_type"] for p in parts if p["mime_type"] not in SUPPORTED_MIMES})
        log.info("email", "attachments of unsupported type ignored",
                 {"messageId": message_id, "types": ",".join(skipped)})
    if not supported:
        return []

    if len(supported) > MAX_ATTACHMENTS_PER_MESSAGE:
        log.warn("email", "too many attachments — taking the first few",
                 {"messageId": message_id, "found": len(supported),
                  "max": MAX_ATTACHMENTS_PER_MESSAGE})
        supported = supported[:MAX_ATTACHMENTS_PER_MESSAGE]

    out: list[dict] = []
    for part in supported:
        label = part["filename"] or f"({part['mime_type']})"

        if part["size"] and part["size"] > MAX_ATTACHMENT_BYTES:
            log.warn("email", "attachment over size cap — not downloaded",
                     {"messageId": message_id, "file": label, "bytes": part["size"]})
            continue

        try:
            if part["inline_data"]:
                data = _decode(part["inline_data"])
            elif part["attachment_id"]:
                res = await asyncio.to_thread(
                    lambda aid=part["attachment_id"]: gmail.users().messages().attachments()
                    .get(userId="me", messageId=message_id, id=aid).execute()
                )
                data = _decode(res.get("data") or "")
            else:
                continue
        except Exception as err:
            log.error("email", "attachment download failed", err,
                      {"messageId": message_id, "file": label})
            continue

        if not data:
            continue
        if len(data) > MAX_ATTACHMENT_BYTES:
            log.warn("email", "attachment over size cap — discarded",
                     {"messageId": message_id, "file": label, "bytes": len(data)})
            continue

        log.info("email", "attachment downloaded",
                 {"messageId": message_id, "file": label,
                  "mime": part["mime_type"], "bytes": len(data)})
        out.append({"filename": part["filename"], "mime_type": part["mime_type"], "data": data})

    return out

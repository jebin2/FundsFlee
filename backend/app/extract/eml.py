"""EML (RFC822) extraction — stdlib only.

Reached only through Gmail: some banks forward the real alert as a
message/rfc822 attachment instead of putting it in the body. There is no
standalone .eml upload path.

Deliberately lenient — a malformed attachment yields empty fields rather than
raising, so one bad message can't fail a whole import run. Nested rfc822 parts
come back as ordinary attachments; the caller owns recursion and its depth cap.
"""
import asyncio
from datetime import datetime
from email import message_from_bytes
from email.policy import default
from email.utils import parsedate_to_datetime


def _decode(value) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value if isinstance(value, str) else ""


def _header(msg, name: str) -> str:
    raw = msg.get(name)
    return str(raw) if raw is not None else ""


def _header_datetime(msg) -> datetime | None:
    raw = _header(msg, "Date")
    if not raw:
        return None
    try:
        return parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None


def _body(msg) -> tuple[str, str]:
    try:
        part = msg.get_body(preferencelist=("plain", "html"))
    except Exception:
        part = None
    if part is None:
        return "", "text/plain"

    try:
        content = _decode(part.get_content())
    except Exception:
        content = _decode(part.get_payload(decode=True) or b"")
    return content, part.get_content_type()


def _attachment_bytes(part) -> bytes:
    # message/rfc822 holds a parsed message object, not a decodable payload —
    # get_payload(decode=True) returns None for it, so re-serialise instead.
    if part.get_content_type() == "message/rfc822":
        payload = part.get_payload()
        inner = payload[0] if isinstance(payload, list) and payload else payload
        return inner.as_bytes() if hasattr(inner, "as_bytes") else _decode(inner).encode()

    raw = part.get_payload(decode=True)
    if raw:
        return raw
    try:
        content = part.get_content()
    except Exception:
        return b""
    if isinstance(content, bytes):
        return content
    if hasattr(content, "as_bytes"):
        return content.as_bytes()
    return _decode(content).encode("utf-8", "replace")


def _parse_eml_sync(data: bytes) -> dict:
    try:
        msg = message_from_bytes(data, policy=default)
    except Exception:
        return {"from": "", "subject": "", "date": None, "body_text": "",
                "body_mime": "text/plain", "attachments": []}

    body_text, body_mime = _body(msg)

    attachments = []
    try:
        parts = list(msg.iter_attachments())
    except Exception:
        parts = []
    for part in parts:
        blob = _attachment_bytes(part)
        if not blob:
            continue
        attachments.append({
            "filename": part.get_filename() or "",
            "mime_type": part.get_content_type(),
            "data": blob,
        })

    return {
        "from": _header(msg, "From"),
        "subject": _header(msg, "Subject"),
        "date": _header_datetime(msg),
        "body_text": body_text,
        "body_mime": body_mime,
        "attachments": attachments,
    }


async def parse_eml(data: bytes) -> dict:
    """Returns {from, subject, date, body_text, body_mime, attachments[]}.

    body_text is raw — callers pass it through ai.parse_email.extract_email_text
    to strip HTML, exactly as the Gmail body path does.
    """
    return await asyncio.to_thread(_parse_eml_sync, data)

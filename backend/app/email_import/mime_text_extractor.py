"""MIME payload text extraction — port of src/server/email-import/mimeTextExtractor.ts."""
import base64


def decode_base64(data: str) -> str:
    s = data.replace("-", "+").replace("_", "/")
    s += "=" * (-len(s) % 4)  # JS Buffer.from is lenient about padding; pad to match
    return base64.b64decode(s).decode("utf-8", errors="replace")


def extract_payload_text(payload: dict | None) -> dict:
    payload = payload or {}
    mime = payload.get("mimeType") or ""

    body = payload.get("body") or {}
    if mime == "text/plain" and body.get("data"):
        return {"text": decode_base64(body["data"]), "mimeType": "text/plain"}

    parts = payload.get("parts")
    if mime.startswith("multipart") and isinstance(parts, list):
        for target_mime in ("text/plain", "text/html"):
            for part in parts:
                p = part or {}
                p_body = p.get("body") or {}
                if p.get("mimeType") == target_mime and p_body.get("data"):
                    return {"text": decode_base64(p_body["data"]), "mimeType": target_mime}
                if (p.get("mimeType") or "").startswith("multipart"):
                    result = extract_payload_text(p)
                    if result["text"]:
                        return result

    if mime == "text/html" and body.get("data"):
        return {"text": decode_base64(body["data"]), "mimeType": "text/html"}

    return {"text": "", "mimeType": "text/plain"}

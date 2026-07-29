"""Email body → readable plain text.

Extraction, not parsing — it lives here rather than beside a prompt because the
walker needs it before any model is involved.
"""
import re

_STYLE_RE = re.compile(r"<style[^>]*>[\s\S]*?</style>", re.IGNORECASE)
_SCRIPT_RE = re.compile(r"<script[^>]*>[\s\S]*?</script>", re.IGNORECASE)
_COMMENT_RE = re.compile(r"<!--[\s\S]*?-->")
_BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_BLOCK_RE = re.compile(r"</?(div|p|tr|li|h[1-6]|section|article)[^>]*>", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def extract_email_text(raw_body: str, mime_type: str) -> str:
    text = raw_body

    if "html" in mime_type:
        text = _STYLE_RE.sub(" ", text)
        text = _SCRIPT_RE.sub(" ", text)
        text = _COMMENT_RE.sub(" ", text)
        text = _BR_RE.sub("\n", text)
        text = _BLOCK_RE.sub("\n", text)
        text = _TAG_RE.sub(" ", text)
        text = (
            text.replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&nbsp;", " ")
            .replace("&#8377;", "₹")
            .replace("&apos;", "'")
            .replace("&quot;", '"')
        )

    return _WS_RE.sub(" ", text).strip()

"""EML extractor — body + attachments out of a forwarded message/rfc822 part."""
import asyncio
from email.message import EmailMessage

from app.extract.eml import _parse_eml_sync, parse_eml

BODY = "Rs 450.00 debited from your account for UPI/SWIGGY/12345 on 15-Jul-2026."


def _alert(body: str = BODY, html: bool = False) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = "alerts@bank.example"
    msg["Subject"] = "Transaction alert"
    msg["Date"] = "Wed, 15 Jul 2026 10:30:00 +0530"
    if html:
        msg.set_content("plain fallback")
        msg.add_alternative(f"<html><body><p>{body}</p></body></html>", subtype="html")
    else:
        msg.set_content(body)
    return msg


class TestHeadersAndBody:
    def test_extracts_headers(self):
        out = _parse_eml_sync(_alert().as_bytes())
        assert out["from"] == "alerts@bank.example"
        assert out["subject"] == "Transaction alert"

    def test_parses_the_date_header(self):
        date = _parse_eml_sync(_alert().as_bytes())["date"]
        assert (date.year, date.month, date.day) == (2026, 7, 15)
        assert (date.hour, date.minute) == (10, 30)

    def test_prefers_plain_text_body(self):
        out = _parse_eml_sync(_alert().as_bytes())
        assert out["body_mime"] == "text/plain"
        assert "450.00" in out["body_text"]

    def test_returns_html_body_raw_for_the_caller_to_strip(self):
        out = _parse_eml_sync(_alert(html=True).as_bytes())
        # get_body prefers plain; either way the caller runs extract_email_text.
        assert out["body_mime"] in ("text/plain", "text/html")
        assert out["body_text"]


class TestAttachments:
    def test_extracts_a_pdf_attachment(self):
        msg = _alert()
        msg.add_attachment(b"%PDF-1.4 statement bytes", maintype="application",
                           subtype="pdf", filename="stmt.pdf")
        out = _parse_eml_sync(msg.as_bytes())
        assert len(out["attachments"]) == 1
        att = out["attachments"][0]
        assert att["filename"] == "stmt.pdf"
        assert att["mime_type"] == "application/pdf"
        assert att["data"] == b"%PDF-1.4 statement bytes"

    def test_extracts_an_image_attachment(self):
        msg = _alert()
        msg.add_attachment(b"\xff\xd8\xff receipt", maintype="image",
                           subtype="jpeg", filename="receipt.jpg")
        att = _parse_eml_sync(msg.as_bytes())["attachments"][0]
        assert att["mime_type"] == "image/jpeg"
        assert att["data"] == b"\xff\xd8\xff receipt"

    def test_nested_rfc822_comes_back_reparseable(self):
        inner = _alert("Rs 999.00 debited for AMAZON on 15-Jul-2026.")
        outer = _alert("See forwarded message below.")
        outer.add_attachment(inner)  # an EmailMessage arg implies message/rfc822

        att = _parse_eml_sync(outer.as_bytes())["attachments"][0]
        assert att["mime_type"] == "message/rfc822"

        # The caller recurses on these bytes — they must parse back cleanly.
        nested = _parse_eml_sync(att["data"])
        assert nested["subject"] == "Transaction alert"
        assert "999.00" in nested["body_text"]

    def test_pdf_inside_a_forwarded_email_survives_one_hop(self):
        inner = _alert()
        inner.add_attachment(b"%PDF-1.4 inner", maintype="application",
                             subtype="pdf", filename="inner.pdf")
        outer = _alert("fwd")
        outer.add_attachment(inner)

        forwarded = _parse_eml_sync(_parse_eml_sync(outer.as_bytes())["attachments"][0]["data"])
        assert forwarded["attachments"][0]["data"] == b"%PDF-1.4 inner"

    def test_plain_email_has_no_attachments(self):
        assert _parse_eml_sync(_alert().as_bytes())["attachments"] == []


class TestLeniency:
    def test_garbage_yields_empty_fields_rather_than_raising(self):
        out = _parse_eml_sync(b"not an email at all")
        assert out["attachments"] == []
        assert out["from"] == "" and out["subject"] == ""

    def test_missing_date_header_is_none(self):
        msg = EmailMessage()
        msg["From"] = "a@b.example"
        msg.set_content("hi")
        assert _parse_eml_sync(msg.as_bytes())["date"] is None


def test_async_wrapper_matches_sync():
    data = _alert().as_bytes()
    assert asyncio.run(parse_eml(data)) == _parse_eml_sync(data)

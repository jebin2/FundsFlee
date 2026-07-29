"""Recursive artifact walker — flattening, depth/budget caps, error units."""
import asyncio
from email.message import EmailMessage

import pymupdf

from app.extract.pipeline import MAX_DEPTH, MAX_UNITS, collect_units


def _run(data, mime, source=""):
    return asyncio.run(collect_units(data, mime, source))


def _kinds(units):
    return [u["kind"] for u in units]


def _digital_pdf() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    y = 72
    for i in range(30):
        page.insert_text((60, y), f"2026-07-15  UPI/SWIGGY/{i:04d}  DEBIT  450.00", fontsize=9)
        y += 12
    return doc.tobytes()


def _encrypted_pdf() -> bytes:
    doc = pymupdf.open()
    doc.new_page().insert_text((60, 72), "secret", fontsize=9)
    return doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="pw", owner_pw="pw")


def _mail(body="Rs 450.00 debited for UPI/SWIGGY on 15-Jul-2026.", attachments=()) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = "alerts@bank.example"
    msg["Subject"] = "Transaction alert"
    msg["Date"] = "Wed, 15 Jul 2026 10:30:00 +0530"
    msg.set_content(body)
    for data, maintype, subtype, name in attachments:
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)
    return msg


class TestFlattening:
    def test_plain_email_yields_one_email_unit(self):
        units = _run(_mail().as_bytes(), "message/rfc822")
        assert _kinds(units) == ["email"]
        assert "450.00" in units[0]["text"]
        assert units[0]["subject"] == "Transaction alert"

    def test_email_with_pdf_yields_email_then_document(self):
        mail = _mail(attachments=[(_digital_pdf(), "application", "pdf", "stmt.pdf")])
        units = _run(mail.as_bytes(), "message/rfc822")
        assert _kinds(units) == ["email", "document"]
        assert units[1]["source"] == "stmt.pdf"
        assert "SWIGGY" in units[1]["text"]

    def test_image_attachment_becomes_an_image_unit(self):
        mail = _mail(attachments=[(b"\xff\xd8\xff jpg", "image", "jpeg", "receipt.jpg")])
        units = _run(mail.as_bytes(), "message/rfc822")
        assert _kinds(units) == ["email", "images"]
        assert units[1]["mime"] == "image/jpeg"
        assert len(units[1]["pages"]) == 1

    def test_bare_pdf_needs_no_email_wrapper(self):
        units = _run(_digital_pdf(), "application/pdf", "upload.pdf")
        assert _kinds(units) == ["document"]

    def test_pdf_inside_a_forwarded_email_is_reached(self):
        inner = _mail(attachments=[(_digital_pdf(), "application", "pdf", "inner.pdf")])
        outer = _mail("fwd")
        outer.add_attachment(inner)
        units = _run(outer.as_bytes(), "message/rfc822")
        assert _kinds(units) == ["email", "email", "document"]
        assert units[2]["source"] == "inner.pdf"

    def test_unsupported_attachment_types_are_ignored(self):
        mail = _mail(attachments=[(b"BEGIN:VCALENDAR", "text", "calendar", "invite.ics")])
        assert _kinds(_run(mail.as_bytes(), "message/rfc822")) == ["email"]

    def test_mime_parameters_are_tolerated(self):
        units = _run(_digital_pdf(), "application/pdf; name=stmt.pdf")
        assert _kinds(units) == ["document"]


class TestCaps:
    def test_recursion_stops_at_max_depth(self):
        msg = _mail("deepest")
        for _ in range(MAX_DEPTH + 2):
            outer = _mail("fwd")
            outer.add_attachment(msg)
            msg = outer
        units = _run(msg.as_bytes(), "message/rfc822")
        assert any(u["kind"] == "error" and "nested too deeply" in u["reason"] for u in units)

    def test_unit_budget_is_enforced(self):
        atts = [(_digital_pdf(), "application", "pdf", f"s{i}.pdf") for i in range(MAX_UNITS + 5)]
        units = _run(_mail(attachments=atts).as_bytes(), "message/rfc822")
        assert len(units) <= MAX_UNITS

    def test_oversized_attachment_is_skipped_with_a_reason(self):
        units = _run(b"x" * (21 * 1024 * 1024), "application/pdf", "huge.pdf")
        assert _kinds(units) == ["error"]
        assert "20MB" in units[0]["reason"]


class TestErrorUnits:
    def test_encrypted_pdf_becomes_an_error_not_an_exception(self):
        mail = _mail(attachments=[(_encrypted_pdf(), "application", "pdf", "locked.pdf")])
        units = _run(mail.as_bytes(), "message/rfc822")
        assert _kinds(units) == ["email", "error"]
        assert "password-protected" in units[1]["reason"]

    def test_one_bad_attachment_does_not_lose_the_good_ones(self):
        mail = _mail(attachments=[
            (b"not a pdf", "application", "pdf", "broken.pdf"),
            (_digital_pdf(), "application", "pdf", "good.pdf"),
        ])
        units = _run(mail.as_bytes(), "message/rfc822")
        assert _kinds(units) == ["email", "error", "document"]

    def test_empty_input_yields_nothing(self):
        assert _run(b"", "application/pdf") == []

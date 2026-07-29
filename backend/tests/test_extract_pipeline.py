"""Recursive artifact walker — flattening, depth/budget caps, error units."""
import asyncio
from email.message import EmailMessage

import pymupdf

from app.extract import pipeline
from app.extract.pipeline import (
    MAX_DEPTH,
    collect_message_units,
    collect_units,
    group_units,
)


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

    def test_group_capacity_is_enforced(self, monkeypatch):
        monkeypatch.setattr(pipeline, "MAX_GROUPS", 3)
        atts = [{"data": _mail(f"alert {i}").as_bytes(),
                 "mime_type": "message/rfc822", "filename": f"a{i}.eml"} for i in range(8)]
        body = {"kind": "email", "text": "fwd", "from": "me@x.com", "subject": "batch", "date": None}
        groups = group_units(asyncio.run(collect_message_units(body, atts, "fwd")))
        assert len(groups) <= 3

    def test_a_group_is_taken_whole_or_not_at_all(self, monkeypatch):
        # Truncating mid-group would price an order from whichever invoices
        # happened to fit — a wrong amount, silently. Skipping loses a row,
        # which the "dropped" warning makes visible.
        monkeypatch.setattr(pipeline, "MAX_GROUPS", 3)
        atts = []
        for i in range(8):
            m = _mail(f"order {i}")
            for n in range(3):
                m.add_attachment(_digital_pdf(), maintype="application", subtype="pdf",
                                 filename=f"inv{i}_{n}.pdf")
            atts.append({"data": m.as_bytes(), "mime_type": "message/rfc822",
                         "filename": f"o{i}.eml"})
        body = {"kind": "email", "text": "fwd", "from": "me@x.com", "subject": "batch", "date": None}
        groups = group_units(asyncio.run(collect_message_units(body, atts, "fwd")))

        # Group 0 is the covering note; every order group keeps all 3 invoices.
        for g in groups[1:]:
            assert _kinds(g) == ["email", "document", "document", "document"]

    def test_oversized_attachment_is_skipped_with_a_reason(self):
        units = _run(b"x" * (21 * 1024 * 1024), "application/pdf", "huge.pdf")
        assert _kinds(units) == ["error"]
        assert "20MB" in units[0]["reason"]


class TestGrouping:
    """A group is one payment. Getting this wrong loses money silently: ten
    forwarded alerts in one group collapse to a single transaction."""

    def _body(self):
        return {"kind": "email", "text": "See attached.", "from": "me@example.com",
                "subject": "Zomato order bills", "date": None, "source": "fwd"}

    def _att(self, msg, name):
        return {"data": msg.as_bytes(), "mime_type": "message/rfc822", "filename": name}

    def test_each_forwarded_alert_gets_its_own_group(self):
        atts = [self._att(_mail(f"Rs {100 + i}.00 debited for MERCHANT{i}."), f"a{i}.eml")
                for i in range(10)]
        units = asyncio.run(collect_message_units(self._body(), atts, "fwd"))
        groups = group_units(units)
        # 1 outer body + 10 forwarded alerts, never merged into one.
        assert len(groups) == 11
        assert all(len(g) == 1 for g in groups)

    def test_a_forwarded_mails_own_documents_join_its_group(self):
        # The Zomato shape, nested: one order + its component invoices must stay
        # together so they merge into a single payment.
        inner = _mail("Your order total is Rs 426.11")
        for n in ("Order_ID.pdf", "Order_Invoice.pdf", "User_Charge.pdf"):
            inner.add_attachment(_digital_pdf(), maintype="application", subtype="pdf", filename=n)
        units = asyncio.run(collect_message_units(self._body(), [self._att(inner, "z.eml")], "fwd"))
        groups = group_units(units)

        assert len(groups) == 2                      # outer body, then the order
        assert _kinds(groups[0]) == ["email"]
        assert _kinds(groups[1]) == ["email", "document", "document", "document"]

    def test_directly_attached_documents_merge_with_the_body(self):
        atts = [{"data": _digital_pdf(), "mime_type": "application/pdf", "filename": "stmt.pdf"}]
        units = asyncio.run(collect_message_units(self._body(), atts, "msg"))
        assert len(group_units(units)) == 1
        assert _kinds(units) == ["email", "document"]

    def test_two_forwarded_mails_each_with_a_pdf(self):
        mails = []
        for i in range(2):
            m = _mail(f"Alert {i}")
            m.add_attachment(_digital_pdf(), maintype="application", subtype="pdf",
                             filename=f"s{i}.pdf")
            mails.append(self._att(m, f"m{i}.eml"))
        groups = group_units(asyncio.run(collect_message_units(self._body(), mails, "fwd")))
        assert [_kinds(g) for g in groups] == [
            ["email"], ["email", "document"], ["email", "document"],
        ]

    def test_standalone_eml_is_a_single_group(self):
        units = _run(_mail().as_bytes(), "message/rfc822")
        assert len(group_units(units)) == 1

    def test_every_unit_carries_a_group(self):
        atts = [self._att(_mail("one"), "a.eml")]
        units = asyncio.run(collect_message_units(self._body(), atts, "fwd"))
        assert all("group" in u for u in units)


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

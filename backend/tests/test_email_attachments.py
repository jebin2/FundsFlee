"""Gmail attachment discovery and download."""
import asyncio
import base64

from app.email_import.attachments import (
    MAX_ATTACHMENTS_PER_MESSAGE,
    MAX_ATTACHMENT_BYTES,
    collect_attachment_parts,
    fetch_attachments,
)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode()


class FakeGmail:
    """Stands in for the googleapiclient chain, recording what was fetched."""

    def __init__(self, blobs: dict[str, bytes], fail: set[str] = frozenset()):
        self.blobs, self.fail, self.fetched = blobs, fail, []

    def users(self):
        return self

    def messages(self):
        return self

    def attachments(self):
        return self

    def get(self, userId, messageId, id):
        self.fetched.append(id)
        outer = self

        class Req:
            def execute(self):
                if id in outer.fail:
                    raise RuntimeError("gmail 500")
                return {"data": _b64(outer.blobs[id])}

        return Req()


def _part(mime, filename="", attachment_id="", data="", size=0, parts=None):
    body = {}
    if attachment_id:
        body["attachmentId"] = attachment_id
    if data:
        body["data"] = data
    if size:
        body["size"] = size
    p = {"mimeType": mime, "filename": filename, "body": body}
    if parts:
        p["parts"] = parts
    return p


def _message(*parts):
    return _part("multipart/mixed", parts=list(parts))


class TestCollecting:
    def test_finds_a_pdf_beside_the_body(self):
        payload = _message(
            _part("text/plain", data=_b64(b"hi")),
            _part("application/pdf", "stmt.pdf", attachment_id="att-1", size=1234),
        )
        found = collect_attachment_parts(payload)
        assert [f["filename"] for f in found] == ["stmt.pdf"]
        assert found[0]["attachment_id"] == "att-1"
        assert found[0]["mime_type"] == "application/pdf"

    def test_walks_nested_multiparts(self):
        payload = _message(
            _part("multipart/alternative", parts=[
                _part("text/plain", data=_b64(b"hi")),
                _part("text/html", data=_b64(b"<p>hi</p>")),
            ]),
            _part("multipart/mixed", parts=[
                _part("application/pdf", "deep.pdf", attachment_id="att-9"),
            ]),
        )
        assert [f["filename"] for f in collect_attachment_parts(payload)] == ["deep.pdf"]

    def test_inline_attachment_without_an_attachment_id(self):
        payload = _message(_part("image/png", "tiny.png", data=_b64(b"\x89PNG")))
        found = collect_attachment_parts(payload)
        assert found[0]["inline_data"] and not found[0]["attachment_id"]

    def test_forwarded_message_is_taken_once_not_also_walked(self):
        # Recursing into an rfc822 part we already took would double-count its
        # own attachments.
        payload = _message(
            _part("message/rfc822", "fwd.eml", attachment_id="att-outer", parts=[
                _part("application/pdf", "inner.pdf", attachment_id="att-inner"),
            ]),
        )
        found = collect_attachment_parts(payload)
        assert [f["filename"] for f in found] == ["fwd.eml"]

    def test_body_only_message_has_none(self):
        assert collect_attachment_parts(_message(_part("text/plain", data=_b64(b"hi")))) == []

    def test_empty_payload_is_safe(self):
        assert collect_attachment_parts(None) == []


class TestFetching:
    def test_downloads_by_attachment_id(self):
        gmail = FakeGmail({"att-1": b"%PDF-1.4 real bytes"})
        payload = _message(_part("application/pdf", "stmt.pdf", attachment_id="att-1"))
        out = asyncio.run(fetch_attachments(gmail, "msg-1", payload))
        assert len(out) == 1
        assert out[0]["data"] == b"%PDF-1.4 real bytes"
        assert gmail.fetched == ["att-1"]

    def test_inline_data_costs_no_api_call(self):
        gmail = FakeGmail({})
        payload = _message(_part("image/png", "tiny.png", data=_b64(b"\x89PNG")))
        out = asyncio.run(fetch_attachments(gmail, "msg-1", payload))
        assert out[0]["data"] == b"\x89PNG"
        assert gmail.fetched == []

    def test_unsupported_types_are_never_downloaded(self):
        gmail = FakeGmail({"att-z": b"zip"})
        payload = _message(_part("application/zip", "photos.zip", attachment_id="att-z"))
        assert asyncio.run(fetch_attachments(gmail, "msg-1", payload)) == []
        assert gmail.fetched == []

    def test_supported_types_survive_alongside_unsupported(self):
        gmail = FakeGmail({"att-p": b"%PDF", "att-z": b"zip"})
        payload = _message(
            _part("application/zip", "x.zip", attachment_id="att-z"),
            _part("application/pdf", "s.pdf", attachment_id="att-p"),
        )
        out = asyncio.run(fetch_attachments(gmail, "msg-1", payload))
        assert [o["filename"] for o in out] == ["s.pdf"]
        assert gmail.fetched == ["att-p"]

    def test_attachment_count_is_capped(self):
        n = MAX_ATTACHMENTS_PER_MESSAGE + 3
        gmail = FakeGmail({f"a{i}": b"%PDF" for i in range(n)})
        payload = _message(*[_part("application/pdf", f"f{i}.pdf", attachment_id=f"a{i}")
                             for i in range(n)])
        out = asyncio.run(fetch_attachments(gmail, "msg-1", payload))
        assert len(out) == MAX_ATTACHMENTS_PER_MESSAGE
        assert len(gmail.fetched) == MAX_ATTACHMENTS_PER_MESSAGE

    def test_declared_oversize_is_not_downloaded(self):
        gmail = FakeGmail({"big": b"x"})
        payload = _message(_part("application/pdf", "big.pdf", attachment_id="big",
                                 size=MAX_ATTACHMENT_BYTES + 1))
        assert asyncio.run(fetch_attachments(gmail, "msg-1", payload)) == []
        assert gmail.fetched == []

    def test_a_failed_download_does_not_lose_the_others(self):
        gmail = FakeGmail({"ok": b"%PDF good", "bad": b""}, fail={"bad"})
        payload = _message(
            _part("application/pdf", "bad.pdf", attachment_id="bad"),
            _part("application/pdf", "ok.pdf", attachment_id="ok"),
        )
        out = asyncio.run(fetch_attachments(gmail, "msg-1", payload))
        assert [o["filename"] for o in out] == ["ok.pdf"]

    def test_no_attachments_makes_no_calls(self):
        gmail = FakeGmail({})
        payload = _message(_part("text/plain", data=_b64(b"hi")))
        assert asyncio.run(fetch_attachments(gmail, "msg-1", payload)) == []
        assert gmail.fetched == []

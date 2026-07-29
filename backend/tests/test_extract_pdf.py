"""PDF extractor — text-layer-first with rasterised fallback."""
import asyncio
import base64

import pymupdf
import pytest

from app.extract.pdf import (
    MAX_RASTER_EDGE,
    PdfEncryptedError,
    PdfInvalidError,
    _extract_pdf_sync,
    extract_pdf,
)

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _digital_pdf(pages: int = 1) -> bytes:
    """A statement-like PDF with a real text layer."""
    doc = pymupdf.open()
    for p in range(pages):
        page = doc.new_page()
        y = 72
        for i in range(30):
            page.insert_text((60, y), f"2026-07-{(i % 28) + 1:02d}  UPI/SWIGGY/{p}{i:04d}  DEBIT  450.00", fontsize=9)
            y += 12
    return doc.tobytes()


def _scanned_pdf(pages: int = 1) -> bytes:
    """No text layer at all — stands in for a scan/photo."""
    doc = pymupdf.open()
    for _ in range(pages):
        doc.new_page()
    return doc.tobytes()


def _encrypted_pdf() -> bytes:
    doc = pymupdf.open()
    doc.new_page().insert_text((60, 72), "secret statement", fontsize=9)
    return doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="hunter2", owner_pw="hunter2")


class TestTextBranch:
    def test_digital_pdf_uses_the_text_layer(self):
        out = _extract_pdf_sync(_digital_pdf())
        assert out["kind"] == "text"
        assert out["pages"] == []
        assert "SWIGGY" in out["text"] and "450.00" in out["text"]

    def test_keeps_line_structure_but_drops_blank_runs(self):
        text = _extract_pdf_sync(_digital_pdf(pages=2))["text"]
        assert "\n" in text            # table layout survives
        assert "\n\n\n" not in text    # blank runs collapsed
        assert not text.startswith("\n") and not text.endswith("\n")

    def test_reports_page_count_without_truncating(self):
        out = _extract_pdf_sync(_digital_pdf(pages=3))
        assert out["page_count"] == 3
        assert out["truncated"] is False


class TestImageFallback:
    def test_pdf_without_text_layer_rasterises(self):
        out = _extract_pdf_sync(_scanned_pdf(pages=2))
        assert out["kind"] == "images"
        assert out["text"] == ""
        assert len(out["pages"]) == 2

    def test_rendered_pages_are_real_png(self):
        page = _extract_pdf_sync(_scanned_pdf())["pages"][0]
        assert base64.b64decode(page).startswith(PNG_MAGIC)

    def test_long_edge_is_capped(self):
        raw = base64.b64decode(_extract_pdf_sync(_scanned_pdf(), dpi=600)["pages"][0])
        pix = pymupdf.Pixmap(raw)
        assert max(pix.width, pix.height) <= MAX_RASTER_EDGE


class TestCaps:
    def test_page_cap_truncates_and_flags(self):
        out = _extract_pdf_sync(_scanned_pdf(pages=4), max_pages=2)
        assert len(out["pages"]) == 2
        assert out["page_count"] == 4
        assert out["truncated"] is True

    def test_cap_applies_to_the_text_branch_too(self):
        out = _extract_pdf_sync(_digital_pdf(pages=4), max_pages=2)
        assert out["kind"] == "text"
        assert out["truncated"] is True
        assert "SWIGGY/3" not in out["text"]  # 4th page never read


class TestFailureModes:
    def test_password_protected_pdf_raises(self):
        with pytest.raises(PdfEncryptedError) as err:
            _extract_pdf_sync(_encrypted_pdf())
        assert "password-protected" in str(err.value)

    def test_garbage_bytes_raise_invalid(self):
        with pytest.raises(PdfInvalidError):
            _extract_pdf_sync(b"this is not a pdf at all")

    def test_empty_bytes_raise_invalid(self):
        with pytest.raises(PdfInvalidError):
            _extract_pdf_sync(b"")


def test_async_wrapper_matches_sync():
    data = _digital_pdf()
    assert asyncio.run(extract_pdf(data)) == _extract_pdf_sync(data)

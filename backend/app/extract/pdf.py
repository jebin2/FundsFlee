"""PDF extraction — embedded text layer first, rasterised pages as fallback.

Digitally generated statements and invoices carry an exact text layer. Reading
it is cheaper and more accurate than asking a vision model to re-read the
pixels: a misread digit in an amount is silent corruption rather than a visible
error. Scanned or photographed PDFs have no usable text layer, so those render
to page images and go down the image provider chain instead.
"""
import asyncio
import base64
import re

import pymupdf

# A dense statement page carries thousands of characters; a scanned page yields
# nothing or a few stray ligatures. 200 sits well clear of both.
MIN_CHARS_PER_PAGE = 200
MAX_PAGES = 25
RASTER_DPI = 150
# Long-edge pixel cap — keeps a rasterised A4 page inside sane vision-token cost.
MAX_RASTER_EDGE = 1600
PAGE_IMAGE_MIME = "image/png"

_TRAILING_WS_RE = re.compile(r"[ \t]+$", re.MULTILINE)
_BLANK_RUN_RE = re.compile(r"\n{3,}")


class PdfError(Exception):
    """Base for PDF problems whose message is safe to show the user verbatim."""


class PdfEncryptedError(PdfError):
    def __init__(self) -> None:
        super().__init__("This PDF is password-protected — remove the password and upload it again.")


class PdfInvalidError(PdfError):
    def __init__(self) -> None:
        super().__init__("This file is not a readable PDF.")


def _tidy(text: str) -> str:
    # Line structure carries the table layout, so only trailing spaces and runs
    # of blank lines go — never collapse newlines themselves.
    return _BLANK_RUN_RE.sub("\n\n", _TRAILING_WS_RE.sub("", text)).strip()


def _render_page(page, dpi: int) -> str:
    long_edge_pt = max(page.rect.width, page.rect.height) or 1
    capped = min(float(dpi), MAX_RASTER_EDGE * 72.0 / long_edge_pt)
    pix = page.get_pixmap(dpi=int(max(capped, 36)))
    return base64.b64encode(pix.tobytes("png")).decode()


def _extract_pdf_sync(data: bytes, max_pages: int = MAX_PAGES, dpi: int = RASTER_DPI) -> dict:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as err:
        raise PdfInvalidError from err

    with doc:
        if doc.needs_pass:
            raise PdfEncryptedError
        page_count = doc.page_count
        if page_count == 0:
            raise PdfInvalidError

        considered = min(page_count, max_pages)
        truncated = page_count > considered

        texts = [doc[i].get_text() for i in range(considered)]
        if sum(len(t.strip()) for t in texts) / considered >= MIN_CHARS_PER_PAGE:
            return {
                "kind": "text",
                "text": _tidy("\n\n".join(texts)),
                "pages": [],
                "page_count": page_count,
                "truncated": truncated,
            }

        return {
            "kind": "images",
            "text": "",
            "pages": [_render_page(doc[i], dpi) for i in range(considered)],
            "page_count": page_count,
            "truncated": truncated,
        }


async def extract_pdf(data: bytes, max_pages: int = MAX_PAGES, dpi: int = RASTER_DPI) -> dict:
    """Returns {kind: "text"|"images", text, pages[b64 png], page_count, truncated}.

    Rasterising is CPU-bound and the deploy runs a single uvicorn worker, so it
    must stay off the event loop.
    """
    return await asyncio.to_thread(_extract_pdf_sync, data, max_pages, dpi)

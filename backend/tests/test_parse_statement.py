"""Statement PDF parsing through the provider chain (text layer or raster)."""
import asyncio
import json

import pytest

from app.ai import parse_statement
from app.ai.parse_statement import StatementParseError, parse_statement_pdf

PROMPT = "system prompt"
TODAY = "2026-07-29"


def _extract(kind, pages=1, text="", images=()):
    async def fake(data, *a, **kw):
        return {"kind": kind, "text": text, "pages": list(images),
                "page_count": pages, "truncated": False, "chars_per_page": 900.0 if kind == "text" else 3.0}

    return fake


def _rows_json(*merchants):
    return json.dumps({"transactions": [
        {"date": TODAY, "amount": 100, "merchant": m, "category": "Others",
         "payment_method": "Card", "notes": None} for m in merchants
    ]})


def _text_ai(monkeypatch, response):
    async def fake(prompt, system, max_tokens=1024):
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(parse_statement, "generate_text", fake)


def _image_ai(monkeypatch, responses):
    calls = []

    async def fake(b64, mime, text, system, max_tokens=2048):
        idx = len(calls)
        calls.append({"mime": mime, "text": text})
        r = responses[idx] if idx < len(responses) else "[]"
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(parse_statement, "generate_with_image", fake)
    return calls


class TestTextLayer:
    def test_digital_statement_uses_the_text_chain(self, monkeypatch):
        monkeypatch.setattr(parse_statement, "extract_pdf",
                            _extract("text", pages=2, text="15/07 SWIGGY 450.00"))
        _text_ai(monkeypatch, _rows_json("Swiggy", "Amazon"))
        rows = asyncio.run(parse_statement_pdf(b"pdf", PROMPT, TODAY))
        assert [r["merchant"] for r in rows] == ["Swiggy", "Amazon"]

    def test_extracted_text_reaches_the_model(self, monkeypatch):
        seen = {}

        async def fake(prompt, system, max_tokens=1024):
            seen["prompt"], seen["system"] = prompt, system
            return _rows_json("Swiggy")

        monkeypatch.setattr(parse_statement, "extract_pdf", _extract("text", text="15/07 SWIGGY 450.00"))
        monkeypatch.setattr(parse_statement, "generate_text", fake)
        asyncio.run(parse_statement_pdf(b"pdf", PROMPT, TODAY))
        assert "15/07 SWIGGY 450.00" in seen["prompt"]
        assert seen["system"] == PROMPT

    def test_empty_transaction_list_is_not_an_error(self, monkeypatch):
        monkeypatch.setattr(parse_statement, "extract_pdf", _extract("text", text="no debits"))
        _text_ai(monkeypatch, json.dumps({"transactions": []}))
        assert asyncio.run(parse_statement_pdf(b"pdf", PROMPT, TODAY)) == []

    def test_unparseable_response_raises(self, monkeypatch):
        monkeypatch.setattr(parse_statement, "extract_pdf", _extract("text", text="x"))
        _text_ai(monkeypatch, "I cannot help with that")
        with pytest.raises(StatementParseError):
            asyncio.run(parse_statement_pdf(b"pdf", PROMPT, TODAY))

    def test_provider_failure_propagates(self, monkeypatch):
        monkeypatch.setattr(parse_statement, "extract_pdf", _extract("text", text="x"))
        _text_ai(monkeypatch, RuntimeError("all providers down"))
        with pytest.raises(RuntimeError):
            asyncio.run(parse_statement_pdf(b"pdf", PROMPT, TODAY))


class TestScanned:
    def test_one_call_per_page_with_rows_accumulated(self, monkeypatch):
        monkeypatch.setattr(parse_statement, "extract_pdf",
                            _extract("images", pages=3, images=["p1", "p2", "p3"]))
        calls = _image_ai(monkeypatch, [_rows_json("A"), _rows_json("B", "C"), _rows_json("D")])
        rows = asyncio.run(parse_statement_pdf(b"pdf", PROMPT, TODAY))
        assert [r["merchant"] for r in rows] == ["A", "B", "C", "D"]
        assert len(calls) == 3
        assert calls[0]["mime"] == "image/png"

    def test_pages_are_numbered_for_the_model(self, monkeypatch):
        monkeypatch.setattr(parse_statement, "extract_pdf",
                            _extract("images", pages=2, images=["p1", "p2"]))
        calls = _image_ai(monkeypatch, [_rows_json("A"), _rows_json("B")])
        asyncio.run(parse_statement_pdf(b"pdf", PROMPT, TODAY))
        assert "page 1 of 2" in calls[0]["text"]
        assert "page 2 of 2" in calls[1]["text"]

    def test_one_bad_page_does_not_lose_the_others(self, monkeypatch):
        monkeypatch.setattr(parse_statement, "extract_pdf",
                            _extract("images", pages=3, images=["p1", "p2", "p3"]))
        _image_ai(monkeypatch, [_rows_json("A"), RuntimeError("timeout"), _rows_json("C")])
        rows = asyncio.run(parse_statement_pdf(b"pdf", PROMPT, TODAY))
        assert [r["merchant"] for r in rows] == ["A", "C"]

    def test_every_page_failing_raises(self, monkeypatch):
        monkeypatch.setattr(parse_statement, "extract_pdf",
                            _extract("images", pages=2, images=["p1", "p2"]))
        _image_ai(monkeypatch, [RuntimeError("x"), RuntimeError("y")])
        with pytest.raises(StatementParseError):
            asyncio.run(parse_statement_pdf(b"pdf", PROMPT, TODAY))

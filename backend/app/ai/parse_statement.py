"""Bank statement PDF parsing, through the provider chain.

Previously both call sites built an AsyncAnthropic client directly and sent the
PDF as a native document block. That worked but had no fallback: with
AI_PROVIDER=opencode and a stale ANTHROPIC_API_KEY, statement parsing was the
one feature that failed while everything else kept working.

Extracting first means a digital statement becomes text — exact digits, cheaper
than page images, and routable through the ordinary text chain. Only a scanned
statement costs vision tokens.

The system prompt stays a parameter: the route and the background job carry
deliberately different ones.
"""
from app.ai.client import generate_text, generate_with_image
from app.ai.parse_json import try_parse_ai_json
from app.core.logger import log
from app.extract.pdf import PAGE_IMAGE_MIME, extract_pdf


class StatementParseError(Exception):
    """The AI produced nothing parseable for any page."""


def _rows(raw: str) -> list[dict]:
    parsed = try_parse_ai_json(raw)
    if not isinstance(parsed, dict):
        return []
    rows = parsed.get("transactions")
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


async def parse_statement_pdf(data: bytes, system_prompt: str, today: str) -> list[dict]:
    """Returns the raw transaction dicts the model reported (unvalidated)."""
    out = await extract_pdf(data)

    if out["kind"] == "text":
        log.info("statement", "parsing text layer",
                 {"pages": out["page_count"], "chars": len(out["text"]),
                  "charsPerPage": out["chars_per_page"], "truncated": out["truncated"]})
        raw = await generate_text(
            f"Today is {today}. Extract all debit transactions from this bank statement.\n\n"
            f"{out['text']}",
            system_prompt,
            4096,
        )
        rows = _rows(raw)
        if not rows and not try_parse_ai_json(raw):
            raise StatementParseError("Could not parse AI response")
        log.info("statement", "text layer parsed", {"rows": len(rows)})
        return rows

    # Scanned: one call per page, since the image chain takes a single image.
    total = len(out["pages"])
    log.info("statement", "parsing rasterised pages",
             {"pages": total, "charsPerPage": out["chars_per_page"], "truncated": out["truncated"]})

    rows: list[dict] = []
    failures = 0
    for i, page in enumerate(out["pages"], 1):
        try:
            raw = await generate_with_image(
                page, PAGE_IMAGE_MIME,
                f"Today is {today}. This is page {i} of {total} of a bank statement. "
                f"Extract all debit transactions visible on THIS page.",
                system_prompt, 4096,
            )
        except Exception as err:
            # One unreadable page should not lose the rest of the statement.
            failures += 1
            log.warn("statement", "page failed", {"page": i, "of": total, "err": str(err)})
            continue
        page_rows = _rows(raw)
        log.info("statement", "page parsed", {"page": i, "of": total, "rows": len(page_rows)})
        rows.extend(page_rows)

    if failures == total:
        raise StatementParseError("Could not parse AI response")
    log.info("statement", "rasterised pages parsed", {"rows": len(rows), "failedPages": failures})
    return rows

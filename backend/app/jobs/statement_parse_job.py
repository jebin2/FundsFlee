"""Bank statement parse job — port of src/server/jobs/statementParseJob.ts.

Calls Anthropic directly with a PDF document block (the provider chain only
handles text/image), so the SYSTEM_PROMPT below is local to this job.
"""
import base64
import json
import re
import uuid

from anthropic import AsyncAnthropic

from app.config import settings
from app.core.dates import today_iso, now_iso
from app.core.deps import SheetSession
from app.core.logger import log
from app.sheets import (
    append_transaction,
    download_receipt_from_drive,
    get_transaction_by_id,
    update_transaction_field,
)

SYSTEM_PROMPT = """You are a bank statement parser for an Indian spending tracker.
Extract all debit transactions from the provided bank statement PDF.

Respond with valid JSON only:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "amount": number,
      "merchant": string,
      "category": string (Food & Dining|Transport|Shopping|Entertainment|Health|Bills & Utilities|Education|Personal Care|Gifts & Donations|Others),
      "payment_method": "UPI"|"Card"|"NetBanking"|"Cash"|"Other",
      "notes": string or null
    }
  ]
}

Rules:
- Only include debits (money out), not credits
- Clean merchant names (e.g. "UPI/SWIGGY" → "Swiggy")
- Infer category from merchant when possible"""

_DRIVE_ID_RE = re.compile(r"/d/([a-zA-Z0-9_-]+)")
_OBJECT_RE = re.compile(r"\{[\s\S]*\}")


def _receipt_file_id(url: str) -> str | None:
    m = _DRIVE_ID_RE.search(url)
    return m.group(1) if m else None


async def run_statement_parse_job(session: SheetSession, placeholder_id: str) -> None:
    log.info("statement-parse", "started", {"placeholderId": placeholder_id})

    try:
        await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {"status": "processing"})
        placeholder = await get_transaction_by_id(session.access_token, session.sheet_id, placeholder_id)
        if not placeholder or not placeholder.get("receipt_url"):
            await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {"status": "failed"})
            log.error("statement-parse", "no receipt_url on placeholder", None, {"placeholderId": placeholder_id})
            return

        file_id = _receipt_file_id(placeholder["receipt_url"])
        if not file_id:
            await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {"status": "failed"})
            return

        downloaded = await download_receipt_from_drive(session.access_token, file_id)
        base64_data = base64.b64encode(downloaded["buffer"]).decode()

        client = AsyncAnthropic(api_key=settings.anthropic_api_key or None)
        msg = await client.messages.create(
            model=settings.ai_model or "claude-sonnet-4-6",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": base64_data}},
                    {"type": "text", "text": f"Today is {today_iso()}. Extract all debit transactions."},
                ],
            }],
        )

        block = msg.content[0]
        if block.type != "text":
            raise RuntimeError("Unexpected AI response type")

        json_match = _OBJECT_RE.search(block.text)
        if not json_match:
            raise RuntimeError("Could not parse AI response")

        rows = json.loads(json_match.group(0)).get("transactions", [])

        log.info("statement-parse", f"extracted {len(rows)} transactions", {"placeholderId": placeholder_id})

        now = now_iso()
        for row in rows:
            tx = {
                "id": str(uuid.uuid4()),
                "date": row.get("date"),
                "time": "00:00",
                "amount": row.get("amount"),
                "merchant": row.get("merchant"),
                "category": row.get("category"),
                "payment_method": row.get("payment_method") or "Other",
                "notes": row.get("notes"),
                "source": "import",
                "receipt_id": placeholder_id,
                "status": "done",
                "created_at": now,
                "updated_at": now,
            }
            await append_transaction(session.access_token, session.sheet_id, tx)

        # Mark placeholder done (don't delete — keeps it as an audit entry)
        await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {
            "deleted": True,
            "status": "done",
        })

        log.info("statement-parse", "done", {"placeholderId": placeholder_id, "count": len(rows)})
    except Exception as err:
        log.error("statement-parse", "failed", err, {"placeholderId": placeholder_id})
        try:
            await update_transaction_field(session.access_token, session.sheet_id, placeholder_id, {"status": "failed"})
        except Exception:
            pass
        raise

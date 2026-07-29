"""Create statement import request — port of src/server/use-cases/createStatementImportRequest.ts."""
import asyncio
import time

from app.core.dates import today_iso
from app.core.deps import SheetSession
from app.core.logger import log
from app.domain.transactions.factory import create_queued_statement_transaction
from app.jobs.statement_parse_job import run_statement_parse_job
from app.sheets import append_transaction, get_or_create_receipts_folder, upload_receipt_to_drive


async def create_statement_import_request(
    session: SheetSession, buffer: bytes, filename: str = ""
) -> dict:
    folder_id = await get_or_create_receipts_folder(session.access_token, session.sheet_id)
    drive_name = f"statement_{today_iso()}_{int(time.time() * 1000)}.pdf"
    uploaded = await upload_receipt_to_drive(
        session.access_token, folder_id, buffer, drive_name, "application/pdf"
    )
    placeholder = create_queued_statement_transaction(uploaded["viewUrl"], filename or drive_name)
    await append_transaction(session.access_token, session.sheet_id, placeholder)

    async def _job():
        try:
            await run_statement_parse_job(session, placeholder["id"])
        except Exception as err:
            log.error("statement-parse", "background job failed", err, {"txId": placeholder["id"]})

    asyncio.create_task(_job())
    return {"txId": placeholder["id"]}

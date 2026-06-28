"""Create text parse request — port of src/server/use-cases/createTextParseRequest.ts."""
import asyncio

from app.core.deps import SheetSession
from app.core.logger import log
from app.domain.transactions.factory import create_queued_text_parse_transaction
from app.jobs.text_parse_job import run_text_parse_job
from app.sheets import append_transaction


async def create_text_parse_request(session: SheetSession, text: str, region: str) -> dict:
    placeholder = create_queued_text_parse_transaction(text)
    await append_transaction(session.access_token, session.sheet_id, placeholder)

    async def _job():
        try:
            await run_text_parse_job(session, placeholder["id"], region)
        except Exception as err:
            log.error("text-parse", "background job failed", err, {"txId": placeholder["id"]})

    asyncio.create_task(_job())
    return {"txId": placeholder["id"]}

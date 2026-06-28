"""Create merge request — port of src/server/use-cases/createMergeRequest.ts."""
import asyncio

from app.core.deps import SheetSession
from app.core.logger import log
from app.domain.transactions.factory import create_merge_placeholder_transaction
from app.jobs.merge_job import run_merge_job
from app.sheets import append_transaction


async def create_merge_request(session: SheetSession, transaction_ids: list[str]) -> dict:
    placeholder = create_merge_placeholder_transaction(transaction_ids)
    await append_transaction(session.access_token, session.sheet_id, placeholder)

    async def _job():
        try:
            await run_merge_job(session, placeholder["id"])
        except Exception as err:
            log.error("merge", "background job failed", err, {"placeholderId": placeholder["id"]})

    asyncio.create_task(_job())
    return {"placeholderId": placeholder["id"]}

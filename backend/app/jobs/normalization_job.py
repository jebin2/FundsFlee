"""Normalization job — port of src/server/jobs/normalizationJob.ts."""
from app.core.deps import SheetSession
from app.services.item_normalization_service import run_item_normalization


async def run_normalization_job(session: SheetSession) -> None:
    await run_item_normalization(session)

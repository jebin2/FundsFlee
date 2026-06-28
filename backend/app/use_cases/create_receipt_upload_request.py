"""Create receipt upload request — port of src/server/use-cases/createReceiptUploadRequest.ts."""
import uuid

from app.core.dates import today_iso
from app.core.deps import SheetSession
from app.domain.transactions.factory import create_queued_receipt_transaction
from app.sheets import append_transaction, get_or_create_receipts_folder, upload_receipt_to_drive


async def create_receipt_upload_request(session: SheetSession, buffer: bytes, mime_type: str) -> dict:
    tx_id = str(uuid.uuid4())
    filename = f"{today_iso()}_{tx_id[:8]}.jpg"
    folder_id = await get_or_create_receipts_folder(session.access_token, session.sheet_id)
    uploaded = await upload_receipt_to_drive(session.access_token, folder_id, buffer, filename, mime_type)
    tx = create_queued_receipt_transaction(uploaded["viewUrl"], tx_id)
    await append_transaction(session.access_token, session.sheet_id, tx)
    return {"txId": tx_id, "receiptUrl": uploaded["viewUrl"]}

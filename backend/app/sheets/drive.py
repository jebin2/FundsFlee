"""Drive / receipts — port of src/lib/sheets/drive.ts."""
import asyncio

from googleapiclient.http import MediaInMemoryUpload

from app.sheets.client import get_drive_client
from app.sheets.meta import _get_meta_values_sync, _set_meta_values_sync

# appProperties are tied to our OAuth client ID — invisible in Drive UI,
# survives renames/moves, and is the authoritative app identifier.
APP_PROP_KEY = "fundsFleeRole"
APP_FOLDER_ROLE = "receipts"
FOLDER_DISPLAY_NAME = "FundsFlee Receipts"


def get_or_create_receipts_folder_sync(access_token: str, sheet_id: str) -> str:
    drive = get_drive_client(access_token)
    meta = _get_meta_values_sync(access_token, sheet_id)

    if meta.get("receipts_folder_id"):
        return meta["receipts_folder_id"]

    # Look up by appProperties first — survives renames
    existing = drive.files().list(
        q=(
            f"appProperties has {{ key='{APP_PROP_KEY}' and value='{APP_FOLDER_ROLE}' }} "
            "and mimeType='application/vnd.google-apps.folder' and trashed=false"
        ),
        fields="files(id)",
        spaces="drive",
        pageSize=1,
    ).execute()

    files = existing.get("files") or []
    if files:
        folder_id = files[0]["id"]
    else:
        folder = drive.files().create(
            body={
                "name": FOLDER_DISPLAY_NAME,
                "mimeType": "application/vnd.google-apps.folder",
                "appProperties": {APP_PROP_KEY: APP_FOLDER_ROLE},
            },
            fields="id",
        ).execute()
        folder_id = folder["id"]

    _set_meta_values_sync(access_token, sheet_id, {"receipts_folder_id": folder_id})
    return folder_id


async def get_or_create_receipts_folder(access_token: str, sheet_id: str) -> str:
    return await asyncio.to_thread(get_or_create_receipts_folder_sync, access_token, sheet_id)


async def upload_receipt_to_drive(
    access_token: str, folder_id: str, image_buffer: bytes, filename: str, mime_type: str
) -> dict:
    def work():
        drive = get_drive_client(access_token)
        file = drive.files().create(
            body={"name": filename, "parents": [folder_id]},
            media_body=MediaInMemoryUpload(image_buffer, mimetype=mime_type),
            fields="id,webViewLink",
        ).execute()
        file_id = file["id"]
        view_url = file.get("webViewLink") or f"https://drive.google.com/file/d/{file_id}/view"
        return {"fileId": file_id, "viewUrl": view_url}
    return await asyncio.to_thread(work)


async def download_receipt_from_drive(access_token: str, file_id: str) -> dict:
    def work():
        drive = get_drive_client(access_token)
        meta = drive.files().get(fileId=file_id, fields="mimeType").execute()
        mime_type = meta.get("mimeType") or "image/jpeg"
        content: bytes = drive.files().get_media(fileId=file_id).execute()
        return {"buffer": content, "mimeType": mime_type}
    return await asyncio.to_thread(work)

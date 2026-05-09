import { Readable } from "stream";
import { getDriveClient } from "./client";
import { getMetaValues, setMetaValue } from "./meta";

// appProperties are tied to our OAuth client ID — invisible in Drive UI,
// survives renames/moves, and is the authoritative app identifier.
const APP_PROP_KEY = "spendingTrackerRole";
const APP_FOLDER_ROLE = "receipts";
const FOLDER_DISPLAY_NAME = "SpendingTracker Receipts";

// ── Drive / Receipts ──────────────────────────────────────────────────────────

export async function getOrCreateReceiptsFolder(
  accessToken: string,
  sheetId: string
): Promise<string> {
  const drive = getDriveClient(accessToken);
  const meta = await getMetaValues(accessToken, sheetId);

  if (meta.receipts_folder_id) return meta.receipts_folder_id;

  // Look up by appProperties first — survives renames
  const existing = await drive.files.list({
    q: `appProperties has { key='${APP_PROP_KEY}' and value='${APP_FOLDER_ROLE}' } and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
    spaces: "drive",
    pageSize: 1,
  });

  let folderId: string;
  if (existing.data.files && existing.data.files.length > 0) {
    folderId = existing.data.files[0].id!;
  } else {
    const folder = await drive.files.create({
      requestBody: {
        name: FOLDER_DISPLAY_NAME,
        mimeType: "application/vnd.google-apps.folder",
        appProperties: { [APP_PROP_KEY]: APP_FOLDER_ROLE },
      },
      fields: "id",
    });
    folderId = folder.data.id!;
  }

  await setMetaValue(accessToken, sheetId, "receipts_folder_id", folderId);
  return folderId;
}

export async function uploadReceiptToDrive(
  accessToken: string,
  folderId: string,
  imageBuffer: Buffer,
  filename: string,
  mimeType: string
): Promise<{ fileId: string; viewUrl: string }> {
  const drive = getDriveClient(accessToken);

  const file = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(imageBuffer),
    },
    fields: "id,webViewLink",
  });

  const fileId = file.data.id!;
  const viewUrl = file.data.webViewLink
    ?? `https://drive.google.com/file/d/${fileId}/view`;

  return { fileId, viewUrl };
}

export async function downloadReceiptFromDrive(
  accessToken: string,
  fileId: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const drive = getDriveClient(accessToken);

  // Get file metadata for mimeType
  const meta = await drive.files.get({ fileId, fields: "mimeType" });
  const mimeType = meta.data.mimeType ?? "image/jpeg";

  // Download content
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );

  return {
    buffer: Buffer.from(res.data as ArrayBuffer),
    mimeType,
  };
}

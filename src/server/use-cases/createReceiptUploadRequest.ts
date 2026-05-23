import { getOrCreateReceiptsFolder, uploadReceiptToDrive, appendTransaction } from "@/lib/sheets";
import { todayISO } from "@/lib/date/iso";
import { createQueuedReceiptTransaction } from "@/domain/transactions/factory";
import type { SheetSession } from "@/server/services/types";

export async function createReceiptUploadRequest(
  session: SheetSession,
  buffer: Buffer,
  mimeType: string
): Promise<{ txId: string; receiptUrl: string }> {
  const txId = crypto.randomUUID();
  const filename = `${todayISO()}_${txId.slice(0, 8)}.jpg`;
  const folderId = await getOrCreateReceiptsFolder(session.accessToken, session.sheetId);
  const { viewUrl } = await uploadReceiptToDrive(session.accessToken, folderId, buffer, filename, mimeType);
  const tx = createQueuedReceiptTransaction(viewUrl, txId);
  await appendTransaction(session.accessToken, session.sheetId, tx);
  return { txId, receiptUrl: viewUrl };
}

import { NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { getOrCreateReceiptsFolder, uploadReceiptToDrive, appendTransaction } from "@/lib/sheets";
import { todayISO } from "@/lib/date/iso";
import { createQueuedReceiptTransaction } from "@/domain/transactions/factory";

export const maxDuration = 60;

export const POST = withSession("POST receipts upload", async (session, req) => {
  const { accessToken, sheetId } = session;
  const formData = await req.formData();
  const image = formData.get("image") as File | null;
  if (!image) return NextResponse.json({ error: "image required" }, { status: 400 });

  const mimeType = image.type || "image/jpeg";
  const buffer = Buffer.from(await image.arrayBuffer());
  const txId = crypto.randomUUID();
  const filename = `${todayISO()}_${txId.slice(0, 8)}.jpg`;

  const folderId = await getOrCreateReceiptsFolder(accessToken, sheetId);
  const { viewUrl } = await uploadReceiptToDrive(accessToken, folderId, buffer, filename, mimeType);
  const tx = createQueuedReceiptTransaction(viewUrl, txId);
  await appendTransaction(accessToken, sheetId, tx);
  return NextResponse.json({ txId, receiptUrl: viewUrl });
});

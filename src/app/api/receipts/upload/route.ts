import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOrCreateReceiptsFolder, uploadReceiptToDrive, appendTransaction } from "@/lib/sheets";
import type { Transaction } from "@/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const image = formData.get("image") as File | null;
  if (!image) return NextResponse.json({ error: "image required" }, { status: 400 });

  const mimeType = image.type || "image/jpeg";
  const buffer = Buffer.from(await image.arrayBuffer());
  const txId = crypto.randomUUID();
  const now = new Date().toISOString();
  const today = now.split("T")[0];
  const time = now.split("T")[1].slice(0, 5);
  const filename = `${today}_${txId.slice(0, 8)}.jpg`;

  try {
    const folderId = await getOrCreateReceiptsFolder(session.access_token, session.sheet_id);
    const { viewUrl } = await uploadReceiptToDrive(session.access_token, folderId, buffer, filename, mimeType);

    const tx: Transaction = {
      id: txId,
      date: today,
      time,
      amount: 0,
      merchant: "Processing…",
      category: "Others",
      payment_method: "Other",
      source: "receipt",
      status: "queued",
      receipt_url: viewUrl,
      created_at: now,
      updated_at: now,
    };

    await appendTransaction(session.access_token, session.sheet_id, tx);
    return NextResponse.json({ txId, receiptUrl: viewUrl });
  } catch (err) {
    console.error("Receipt upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

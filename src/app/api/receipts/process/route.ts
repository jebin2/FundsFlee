import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getTransactionById,
  downloadReceiptFromDrive,
  updateTransactionField,
  getTransactions,
  appendTransaction,
} from "@/lib/sheets";
import { parseReceiptImage } from "@/lib/ai/parse-image";
import { checkDuplicate } from "@/lib/ai/dedup";
import { apiError } from "@/lib/api-error";
import type { Transaction } from "@/types";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { txId, region } = await req.json();
  if (!txId) return NextResponse.json({ error: "txId required" }, { status: 400 });

  const sheetId = session.sheet_id;

  // Mark the placeholder queued entry as processing
  await updateTransactionField(session.access_token, sheetId, txId, { status: "processing" });

  try {
    const placeholder = await getTransactionById(session.access_token, sheetId, txId);
    if (!placeholder?.receipt_url) {
      await updateTransactionField(session.access_token, sheetId, txId, { status: "failed" });
      return NextResponse.json({ error: "Placeholder or receipt URL not found" }, { status: 404 });
    }

    const fileIdMatch = placeholder.receipt_url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!fileIdMatch) {
      await updateTransactionField(session.access_token, sheetId, txId, { status: "failed" });
      return NextResponse.json({ error: "Could not extract file ID" }, { status: 400 });
    }

    const { buffer, mimeType } = await downloadReceiptFromDrive(session.access_token, fileIdMatch[1]);

    const validTypes = ["image/jpeg", "image/png", "image/webp"] as const;
    type ValidMime = typeof validTypes[number];
    const claudeMime: ValidMime = validTypes.includes(mimeType as ValidMime)
      ? (mimeType as ValidMime)
      : "image/jpeg";

    const today = new Date().toISOString().split("T")[0];
    const receipt = await parseReceiptImage(buffer.toString("base64"), claudeMime, region, today);

    // receipt_id groups all items from this scan together
    const receiptId = txId; // reuse the placeholder's txId as the receipt group id
    const now = new Date().toISOString();

    const recent = await getTransactions(session.access_token, sheetId, 100);

    // Create one transaction per line item
    const createdIds: string[] = [];
    for (const item of receipt.items) {
      const itemTxId = crypto.randomUUID();
      const tx: Transaction = {
        id: itemTxId,
        date: receipt.date,
        time: receipt.time,
        amount: item.price,
        merchant: receipt.merchant,
        category: item.category || receipt.category,
        item_name: item.name,
        payment_method: receipt.payment_method,
        source: "receipt",
        receipt_url: placeholder.receipt_url,
        receipt_id: receiptId,
        status: "done",
        quantity: item.qty > 1
          ? `${item.qty}${item.unit ? ` ${item.unit}` : ""}`
          : item.unit
          ? `1 ${item.unit}`
          : undefined,
        notes: item.unit_price != null && item.qty > 1
          ? `₹${item.unit_price}/unit`
          : undefined,
        created_at: now,
        updated_at: now,
      };

      const dupResult = await checkDuplicate(tx, recent.filter((t) => !createdIds.includes(t.id)));
      if (dupResult.is_duplicate && dupResult.confidence > 0.7) {
        tx.is_duplicate = true;
        tx.duplicate_ref = dupResult.duplicate_of_id;
      }

      await appendTransaction(session.access_token, sheetId, tx);
      createdIds.push(itemTxId);
    }

    // Mark the original placeholder as deleted (replaced by per-item entries)
    await updateTransactionField(session.access_token, sheetId, txId, {
      deleted: true,
      status: "done",
    });

    return NextResponse.json({ ok: true, txId: receiptId, itemCount: receipt.items.length });
  } catch (err) {
    await updateTransactionField(session.access_token, sheetId, txId, { status: "failed" }).catch(() => {});
    return apiError("Receipt processing error", err);
  }
}

import { updateTransactionField, getOrCreateReceiptsFolder, uploadReceiptToDrive, getAllTransactions, appendTransaction } from "@/lib/sheets";
import { runTextParseJob } from "@/server/jobs/textParseJob";
import { processReceipt } from "@/server/services/receiptProcessingService";
import { log } from "@/lib/logger";
import type { PaymentMethod } from "@/types";
import type { SheetSession } from "@/server/services/types";

export interface TxContext {
  merchant: string;
  amount: number;
  date: string;
  time?: string;
  payment_method: string;
  notes?: string;
}

export interface EnrichInput {
  txId: string;
  receiptId?: string;  // when set, replace the entire receipt group with fresh AI parse
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  region?: string;
  txContext?: TxContext;
}

/** Soft-deletes all existing group items and appends a fresh "processing" placeholder.
 *  Returns the new placeholder txId. Call this in the route handler (before returning)
 *  so the client can refresh and immediately see the processing state. */
export async function prepareReceiptRetry(
  session: SheetSession,
  receiptId: string,
  txContext: TxContext | undefined,
): Promise<string> {
  log.info("enrich", "receipt retry — clearing group", { receiptId });
  const all = await getAllTransactions(session.accessToken, session.sheetId);
  const groupItems = all.filter((t) => t.receipt_id === receiptId && !t.deleted);

  // Idempotency: if a processing placeholder already exists, a concurrent retry is
  // already in flight — reuse it rather than creating a second orphaned placeholder.
  // Exception: if the placeholder is older than 15 min it was likely orphaned by a
  // server crash before the job could start, so fall through and replace it.
  const STALE_MS = 15 * 60 * 1000;
  const existing = groupItems.find((t) => t.status === "processing");
  if (existing) {
    const ageMs = Date.now() - new Date(existing.created_at).getTime();
    if (ageMs < STALE_MS) {
      log.info("enrich", "receipt retry — already processing, reusing placeholder", { txId: existing.id, receiptId });
      return existing.id;
    }
    log.info("enrich", "receipt retry — stale placeholder, replacing", { txId: existing.id, ageMs, receiptId });
    // falls through — existing is included in groupItems and will be soft-deleted below
  }

  await Promise.all(
    groupItems.map((item) => updateTransactionField(session.accessToken, session.sheetId, item.id, { deleted: true }))
  );
  const now = new Date().toISOString();
  const txId = crypto.randomUUID();
  await appendTransaction(session.accessToken, session.sheetId, {
    id: txId,
    merchant:       txContext?.merchant ?? "",
    amount:         txContext?.amount ?? 0,
    date:           txContext?.date ?? now.slice(0, 10),
    time:           txContext?.time ?? "",
    payment_method: (txContext?.payment_method ?? "UPI") as PaymentMethod,
    category:       "",
    source:         "receipt",
    receipt_id:     receiptId,
    status:         "processing",
    created_at:     now,
    updated_at:     now,
  });
  log.info("enrich", "receipt retry — placeholder created", { txId, receiptId });
  return txId;
}

function buildEnrichedRawInput(ctx: TxContext | undefined, userText: string): string {
  if (!ctx) return userText;
  const lines = [
    `Merchant: ${ctx.merchant}`,
    `Amount: ₹${ctx.amount}`,
    `Date: ${ctx.date}`,
    ctx.time  ? `Time: ${ctx.time}`   : "",
    `Payment: ${ctx.payment_method}`,
    ctx.notes ? `Notes: ${ctx.notes}` : "",
  ].filter(Boolean);
  return `${lines.join("\n")}\n\nUser added:\n${userText}`;
}

export async function runEnrichTransactionJob(
  session: SheetSession,
  input: EnrichInput
): Promise<void> {
  const { txId, receiptId, text, imageBase64, imageMimeType, region = "", txContext } = input;

  log.info("enrich", "started", { txId });

  try {
    if (imageBase64 && imageMimeType) {
      const folderId = await getOrCreateReceiptsFolder(session.accessToken, session.sheetId);
      const buffer   = Buffer.from(imageBase64, "base64");
      const ext      = imageMimeType.split("/")[1] ?? "jpg";
      const { viewUrl } = await uploadReceiptToDrive(
        session.accessToken, folderId, buffer,
        `enrich-${txId}-${Date.now()}.${ext}`, imageMimeType
      );
      await updateTransactionField(session.accessToken, session.sheetId, txId, { receipt_url: viewUrl });
      const result = await processReceipt(session, {
        txId,
        region,
        receiptGroupId: receiptId,  // preserve original receipt_id grouping on retry
        fallback: txContext ? {
          merchant:       txContext.merchant,
          payment_method: txContext.payment_method as PaymentMethod,
        } : undefined,
      });
      if ("error" in result) {
        log.error("enrich", "processReceipt returned error", undefined, { txId, error: result.error });
      }
    } else if (text) {
      const combined = buildEnrichedRawInput(txContext, text);
      await updateTransactionField(session.accessToken, session.sheetId, txId, { raw_input: combined });
      await runTextParseJob(session, txId, region);
    }
  } catch (err) {
    log.error("enrich", "failed", err, { txId });
    await updateTransactionField(session.accessToken, session.sheetId, txId, { status: "failed" }).catch(() => {});
  }

  log.info("enrich", "done", { txId });
}

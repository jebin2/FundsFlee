import { updateTransactionField, getOrCreateReceiptsFolder, uploadReceiptToDrive } from "@/lib/sheets";
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
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  region?: string;
  txContext?: TxContext;
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
  const { txId, text, imageBase64, imageMimeType, region = "", txContext } = input;
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
    await updateTransactionField(session.accessToken, session.sheetId, txId, { status: "done" }).catch(() => {});
  }

  log.info("enrich", "done", { txId });
}

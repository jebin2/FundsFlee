import { parseTransactionText } from "@/lib/ai/parse-text";
import { getTransactionById, updateTransactionField } from "@/lib/sheets";
import { todayISO } from "@/lib/date/iso";
import { log } from "@/lib/logger";
import type { SheetSession } from "@/server/services/types";

export async function runTextParseJob(
  session: SheetSession,
  txId: string,
  region = ""
): Promise<void> {
  log.info("text-parse", "started", { txId });

  await updateTransactionField(session.accessToken, session.sheetId, txId, { status: "processing" });

  try {
    const placeholder = await getTransactionById(session.accessToken, session.sheetId, txId);
    if (!placeholder?.raw_input) {
      await updateTransactionField(session.accessToken, session.sheetId, txId, { status: "failed" });
      log.error("text-parse", "no raw_input on placeholder", { txId });
      return;
    }

    const parsed = await parseTransactionText(placeholder.raw_input, region, todayISO());

    await updateTransactionField(session.accessToken, session.sheetId, txId, {
      date:           parsed.date,
      time:           parsed.time,
      amount:         parsed.amount,
      merchant:       parsed.merchant,
      category:       parsed.category,
      subcategory:    parsed.subcategory,
      item_name:      parsed.item_name,
      payment_method: parsed.payment_method,
      notes:          parsed.notes,
      status:         "done",
      updated_at:     new Date().toISOString(),
    });

    log.info("text-parse", "done", { txId, merchant: parsed.merchant, amount: parsed.amount });
  } catch (err) {
    log.error("text-parse", "failed", { txId, err });
    await updateTransactionField(session.accessToken, session.sheetId, txId, { status: "failed" }).catch(() => {});
    throw err;
  }
}

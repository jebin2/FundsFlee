import { parseTransactionText } from "@/lib/ai/parse-text";
import { getTransactionById, updateTransactionField } from "@/lib/sheets";
import { todayISO } from "@/lib/date/iso";
import { log } from "@/lib/logger";
import { expandItemsToRows, itemQuantity } from "@/server/services/expandItems";
import type { SheetSession } from "@/server/services/types";

export async function runTextParseJob(
  session: SheetSession,
  txId: string,
  region = ""
): Promise<void> {
  log.info("text-parse", "started", { txId });

  try {
    await updateTransactionField(session.accessToken, session.sheetId, txId, { status: "processing" });
    const placeholder = await getTransactionById(session.accessToken, session.sheetId, txId);
    if (!placeholder?.raw_input) {
      await updateTransactionField(session.accessToken, session.sheetId, txId, { status: "failed" });
      log.error("text-parse", "no raw_input on placeholder", { txId });
      return;
    }

    const parsed = await parseTransactionText(placeholder.raw_input, region, todayISO());
    const items = parsed.items ?? [];
    const now = new Date().toISOString();

    if (items.length > 1) {
      await expandItemsToRows(session, txId, {
        date: parsed.date,
        time: parsed.time,
        merchant: parsed.merchant,
        category: parsed.category,
        subcategory: parsed.subcategory,
        payment_method: parsed.payment_method,
        notes: parsed.notes,
        source: placeholder.source,
        raw_input: placeholder.raw_input,
        receipt_id: txId,
      }, items, now, parsed.amount);
    } else {
      const singleItem = items[0];
      await updateTransactionField(session.accessToken, session.sheetId, txId, {
        date:           parsed.date,
        time:           parsed.time,
        amount:         parsed.amount,
        merchant:       parsed.merchant,
        category:       parsed.category,
        subcategory:    parsed.subcategory,
        item_name:      singleItem?.name ?? parsed.item_name,
        quantity:       singleItem ? itemQuantity(singleItem.qty, singleItem.unit) : undefined,
        payment_method: parsed.payment_method,
        notes:          parsed.notes,
        status:         "done",
        updated_at:     now,
      });
    }

    log.info("text-parse", "done", { txId, merchant: parsed.merchant, amount: parsed.amount, itemCount: items.length });
  } catch (err) {
    log.error("text-parse", "failed", err, { txId });
    await updateTransactionField(session.accessToken, session.sheetId, txId, { status: "failed" }).catch(() => {});
    throw err;
  }
}

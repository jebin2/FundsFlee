import { mergeTransactions } from "@/lib/ai/merge-transactions";
import {
  getTransactionById,
  updateTransactionField,
  getAllTransactions,
} from "@/lib/sheets";
import { log } from "@/lib/logger";
import type { SheetSession } from "@/server/services/types";
import type { Transaction } from "@/types";

const RETRY_DELAYS_MS = [5_000, 15_000, 45_000]; // 5s, 15s, 45s

// Parse the source IDs out of the placeholder's notes field.
// Format stored by the request endpoint: "merge_source:id1,id2,id3"
export function parseMergeSourceIds(notes: string | undefined): string[] {
  const match = notes?.match(/merge_source:([^\s|]+)/);
  if (!match) return [];
  return match[1].split(",").filter(Boolean);
}

export async function runMergeJob(
  session: SheetSession,
  placeholderId: string
): Promise<void> {
  log.info("merge", `started`, { placeholderId });

  await updateTransactionField(session.accessToken, session.sheetId, placeholderId, {
    status: "merging",
  });

  const placeholder = await getTransactionById(session.accessToken, session.sheetId, placeholderId);
  if (!placeholder) {
    log.error("merge", "placeholder not found", { placeholderId });
    return;
  }

  const sourceIds = parseMergeSourceIds(placeholder.notes);
  if (sourceIds.length < 2) {
    log.error("merge", "fewer than 2 source IDs in placeholder notes", { notes: placeholder.notes });
    await updateTransactionField(session.accessToken, session.sheetId, placeholderId, { status: "merge_failed" });
    return;
  }

  // Read all source transactions from the sheet
  const allTxs = await getAllTransactions(session.accessToken, session.sheetId);
  const sources = sourceIds
    .map((id) => allTxs.find((t) => t.id === id))
    .filter((t): t is Transaction => t != null);

  if (sources.length < 2) {
    log.warn("merge", "could not find all source transactions", { sourceIds, found: sources.length });
    await updateTransactionField(session.accessToken, session.sheetId, placeholderId, { status: "merge_failed" });
    return;
  }

  // ── Retry loop ────────────────────────────────────────────────────────────
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      log.info("merge", `retry attempt ${attempt + 1}`, { placeholderId });
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
    try {
      const merged = await mergeTransactions(sources);

      const now = new Date().toISOString();
      const receiptSource = sources.find((s) => s.source === "receipt");

      // merge_id is shared by the merged result AND all source transactions
      // so you can always trace which entries were combined.
      const mergeId = placeholderId;

      await updateTransactionField(session.accessToken, session.sheetId, placeholderId, {
        date:           merged.date           ?? sources[0].date,
        time:           merged.time           ?? sources[0].time,
        amount:         merged.amount         ?? sources[0].amount,
        merchant:       merged.merchant       ?? sources[0].merchant,
        category:       merged.category       ?? sources[0].category,
        subcategory:    merged.subcategory,
        item_name:      merged.item_name,
        payment_method: merged.payment_method ?? sources[0].payment_method,
        notes:          merged.notes,
        receipt_url:    merged.receipt_url    ?? receiptSource?.receipt_url,
        receipt_id:     receiptSource?.receipt_id,
        source:         "merge",
        is_duplicate:   false,
        duplicate_ref:  undefined,
        merge_id:       mergeId,
        status:         "done",
        updated_at:     now,
      });

      // Soft-delete all source transactions and stamp them with the same merge_id
      for (const src of sources) {
        await updateTransactionField(session.accessToken, session.sheetId, src.id, {
          deleted:  true,
          merge_id: mergeId,
        });
      }

      log.info("merge", `done — merged ${sources.length} transactions`, { placeholderId });
      return;
    } catch (err) {
      lastError = err;
      log.warn("merge", `attempt ${attempt + 1} failed`, { placeholderId, err: String(err) });
    }
  }

  // All attempts exhausted
  log.error("merge", "all retries failed — marking merge_failed", { placeholderId, err: lastError });
  await updateTransactionField(session.accessToken, session.sheetId, placeholderId, {
    status: "merge_failed",
  });
}

// Called by the daily cron to retry any stuck merge_failed transactions.
export async function retryFailedMerges(session: SheetSession): Promise<void> {
  const allTxs = await getAllTransactions(session.accessToken, session.sheetId);
  const failed = allTxs.filter((t) => t.status === "merge_failed" && t.source === "merge");
  if (failed.length === 0) return;
  log.info("merge", `retrying ${failed.length} failed merge(s)`);
  for (const tx of failed) {
    await runMergeJob(session, tx.id).catch((err) =>
      log.error("merge", "cron retry failed", { id: tx.id, err })
    );
  }
}

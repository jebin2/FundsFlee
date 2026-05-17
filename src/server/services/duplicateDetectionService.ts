import { findDuplicates } from "@/lib/ai/dedup";
import { getMetaValues, getAllTransactions, setMetaValue, updateTransactionField } from "@/lib/sheets";
import { log } from "@/lib/logger";
import type { SheetSession } from "./types";

const RUN_INTERVAL_MS = 60 * 60 * 1000;

function isAiUnavailableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("API key") ||
    message.includes("API Key") ||
    message.includes("quota") ||
    message.includes("429") ||
    message.includes("503")
  );
}

export async function runDuplicateDetection(session: SheetSession): Promise<void> {
  log.info("dedup", "started");
  await setMetaValue(session.accessToken, session.sheetId, "dedup_running_at", new Date().toISOString()).catch(() => {});

  try {
    const transactions = await getAllTransactions(session.accessToken, session.sheetId);
    log.info("dedup", `scanning ${transactions.length} transactions`);

    const previousDuplicates = transactions.filter((tx) => tx.is_duplicate);
    if (previousDuplicates.length > 0) {
      log.info("dedup", `clearing ${previousDuplicates.length} previous duplicate flags`);
      await Promise.all(
        previousDuplicates.map((tx) =>
          updateTransactionField(session.accessToken, session.sheetId, tx.id, {
            is_duplicate: false,
            duplicate_ref: undefined,
          })
        )
      );
    }

    const groups = await findDuplicates(transactions);
    log.info("dedup", `found ${groups.length} duplicate group(s)`);

    if (groups.length > 0) {
      await Promise.all(
        groups.flatMap((group) =>
          group.duplicate_ids.map((duplicateId) =>
            updateTransactionField(session.accessToken, session.sheetId, duplicateId, {
              is_duplicate: true,
              duplicate_ref: group.original_id,
            })
          )
        )
      );
    }

    await setMetaValue(session.accessToken, session.sheetId, "last_dedup_checked_at", new Date().toISOString());
    log.info("dedup", "done");
  } finally {
    await setMetaValue(session.accessToken, session.sheetId, "dedup_running_at", "").catch(() => {});
  }
}

export async function requestDuplicateDetection(
  session: SheetSession
): Promise<{ skipped: true } | { done: true } | { error: "ai_unavailable" | "detection_failed" }> {
  const meta = await getMetaValues(session.accessToken, session.sheetId);
  const lastRun = meta.last_dedup_checked_at ? new Date(meta.last_dedup_checked_at).getTime() : 0;

  if (Date.now() - lastRun < RUN_INTERVAL_MS) {
    return { skipped: true };
  }

  try {
    await runDuplicateDetection(session);
    return { done: true };
  } catch (err) {
    log.error("dedup", "detection failed", err);
    return { error: isAiUnavailableError(err) ? "ai_unavailable" : "detection_failed" };
  }
}

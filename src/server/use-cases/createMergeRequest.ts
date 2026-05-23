import { appendTransaction } from "@/lib/sheets";
import { runMergeJob } from "@/server/jobs/mergeJob";
import { log } from "@/lib/logger";
import { createMergePlaceholderTransaction } from "@/domain/transactions/factory";
import type { SheetSession } from "@/server/services/types";

export async function createMergeRequest(
  session: SheetSession,
  transactionIds: string[]
): Promise<{ placeholderId: string }> {
  const placeholder = createMergePlaceholderTransaction(transactionIds);
  await appendTransaction(session.accessToken, session.sheetId, placeholder);
  runMergeJob(session, placeholder.id).catch((err) => {
    log.error("merge", "background job failed", err, { placeholderId: placeholder.id });
  });
  return { placeholderId: placeholder.id };
}

import { appendTransaction } from "@/lib/sheets";
import { runTextParseJob } from "@/server/jobs/textParseJob";
import { log } from "@/lib/logger";
import { createQueuedTextParseTransaction } from "@/domain/transactions/factory";
import type { SheetSession } from "@/server/services/types";

export async function createTextParseRequest(
  session: SheetSession,
  text: string,
  region: string
): Promise<{ txId: string }> {
  const placeholder = createQueuedTextParseTransaction(text);
  await appendTransaction(session.accessToken, session.sheetId, placeholder);
  runTextParseJob(session, placeholder.id, region).catch((err) => {
    log.error("text-parse", "background job failed", err, { txId: placeholder.id });
  });
  return { txId: placeholder.id };
}

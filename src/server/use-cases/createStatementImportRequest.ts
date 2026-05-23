import { getOrCreateReceiptsFolder, uploadReceiptToDrive, appendTransaction } from "@/lib/sheets";
import { runStatementParseJob } from "@/server/jobs/statementParseJob";
import { log } from "@/lib/logger";
import { todayISO } from "@/lib/date/iso";
import { createQueuedStatementTransaction } from "@/domain/transactions/factory";
import type { SheetSession } from "@/server/services/types";

export async function createStatementImportRequest(
  session: SheetSession,
  buffer: Buffer
): Promise<{ txId: string }> {
  const folderId = await getOrCreateReceiptsFolder(session.accessToken, session.sheetId);
  const filename = `statement_${todayISO()}_${Date.now()}.pdf`;
  const { viewUrl } = await uploadReceiptToDrive(
    session.accessToken, folderId, buffer, filename, "application/pdf"
  );
  const placeholder = createQueuedStatementTransaction(viewUrl);
  await appendTransaction(session.accessToken, session.sheetId, placeholder);
  runStatementParseJob(session, placeholder.id).catch((err) => {
    log.error("statement-parse", "background job failed", err, { txId: placeholder.id });
  });
  return { txId: placeholder.id };
}

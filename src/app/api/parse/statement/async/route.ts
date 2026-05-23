import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import {
  getOrCreateReceiptsFolder,
  uploadReceiptToDrive,
  appendTransaction,
} from "@/lib/sheets";
import { runStatementParseJob } from "@/server/jobs/statementParseJob";
import { todayISO } from "@/lib/date/iso";
import { log } from "@/lib/logger";
import { createQueuedStatementTransaction } from "@/domain/transactions/factory";

export const maxDuration = 60;

// POST /api/parse/statement/async  (multipart form: file=PDF)
// Uploads the PDF to Drive, creates a queued placeholder, fires AI parse in background.
export const POST = withSession("POST parse/statement/async", async (session, req: NextRequest) => {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.type !== "application/pdf")
    return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
  if (file.size > 20 * 1024 * 1024)
    return NextResponse.json({ error: "File too large (max 20MB)" }, { status: 400 });

  const buffer   = Buffer.from(await file.arrayBuffer());
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

  return NextResponse.json({ ok: true, txId: placeholder.id });
});

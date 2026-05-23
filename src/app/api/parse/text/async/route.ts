import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { appendTransaction } from "@/lib/sheets";
import { runTextParseJob } from "@/server/jobs/textParseJob";
import { log } from "@/lib/logger";
import { createQueuedTextParseTransaction } from "@/domain/transactions/factory";

// POST /api/parse/text/async
// Body: { text: string, region?: string }
// Creates a queued placeholder immediately and fires the AI parse in background.
export const POST = withSession("POST parse/text/async", async (session, req: NextRequest) => {
  const { text, region = "" } = await req.json() as { text: string; region?: string };
  if (!text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });

  const placeholder = createQueuedTextParseTransaction(text);

  await appendTransaction(session.accessToken, session.sheetId, placeholder);
  runTextParseJob(session, placeholder.id, region).catch((err) => {
    log.error("text-parse", "background job failed", err, { txId: placeholder.id });
  });

  return NextResponse.json({ ok: true, txId: placeholder.id });
});

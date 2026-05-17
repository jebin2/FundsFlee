import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { runTextParseJob } from "@/server/jobs/textParseJob";

// POST /api/parse/text/process?txId=xxx&region=xxx
// Re-triggers the text parse job for a failed/queued placeholder (manual retry).
export const POST = withSession("POST parse/text/process", async (session, req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const txId  = searchParams.get("txId");
  const region = searchParams.get("region") ?? "";
  if (!txId) return NextResponse.json({ error: "txId required" }, { status: 400 });

  runTextParseJob(session, txId, region).catch(() => {});
  return NextResponse.json({ ok: true });
});

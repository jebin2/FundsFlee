import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { runStatementParseJob } from "@/server/jobs/statementParseJob";

// POST /api/parse/statement/process?txId=xxx
// Re-triggers the statement parse job for a failed placeholder (manual retry).
export const POST = withSession("POST parse/statement/process", async (session, req: NextRequest) => {
  const txId = new URL(req.url).searchParams.get("txId");
  if (!txId) return NextResponse.json({ error: "txId required" }, { status: 400 });
  runStatementParseJob(session, txId).catch(() => {});
  return NextResponse.json({ ok: true });
});

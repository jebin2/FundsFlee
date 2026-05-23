import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { appendTransaction } from "@/lib/sheets";
import { runMergeJob } from "@/server/jobs/mergeJob";
import { log } from "@/lib/logger";
import { createMergePlaceholderTransaction } from "@/domain/transactions/factory";

// POST /api/duplicates/merge
// Body: { transactionIds: string[] }
// Returns immediately after creating the placeholder — the AI job runs in background.
export const POST = withSession("POST duplicates/merge", async (session, req: NextRequest) => {
  const { transactionIds } = await req.json() as { transactionIds: string[] };

  if (!transactionIds || transactionIds.length < 2) {
    return NextResponse.json({ error: "Need at least 2 transaction IDs to merge" }, { status: 400 });
  }

  const placeholder = createMergePlaceholderTransaction(transactionIds);

  await appendTransaction(session.accessToken, session.sheetId, placeholder);

  // Fire-and-forget — responds immediately, job runs in background
  runMergeJob(session, placeholder.id).catch((err) => {
    log.error("merge", "background job failed", err, { placeholderId: placeholder.id });
  });

  return NextResponse.json({ ok: true, placeholderId: placeholder.id });
});

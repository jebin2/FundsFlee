import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { appendTransaction } from "@/lib/sheets";
import { runMergeJob } from "@/server/jobs/mergeJob";
import { log } from "@/lib/logger";
import { todayISO } from "@/lib/date/iso";
import type { Transaction } from "@/types";

// POST /api/duplicates/merge
// Body: { transactionIds: string[] }
// Returns immediately after creating the placeholder — the AI job runs in background.
export const POST = withSession("POST duplicates/merge", async (session, req: NextRequest) => {
  const { transactionIds } = await req.json() as { transactionIds: string[] };

  if (!transactionIds || transactionIds.length < 2) {
    return NextResponse.json({ error: "Need at least 2 transaction IDs to merge" }, { status: 400 });
  }

  // Create a placeholder transaction that the UI can track
  const now = new Date().toISOString();
  const placeholder: Transaction = {
    id:             crypto.randomUUID(),
    date:           todayISO(),
    time:           now.split("T")[1].slice(0, 5),
    amount:         0,
    merchant:       "Merging…",
    category:       "Others",
    payment_method: "Other",
    source:         "merge",
    status:         "merging",
    // Encode source IDs so the background job can find them
    notes:          `merge_source:${transactionIds.join(",")}`,
    created_at:     now,
    updated_at:     now,
  };

  await appendTransaction(session.accessToken, session.sheetId, placeholder);

  // Fire-and-forget — responds immediately, job runs in background
  runMergeJob(session, placeholder.id).catch((err) => {
    log.error("merge", "background job failed", err, { placeholderId: placeholder.id });
  });

  return NextResponse.json({ ok: true, placeholderId: placeholder.id });
});

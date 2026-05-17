import { NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { requestDuplicateDetection, runDuplicateDetection } from "@/server/services/duplicateDetectionService";

export const POST = withSession("POST duplicates detect", async (session) => {
  // Check cooldown via requestDuplicateDetection — if within 1 hour, skip
  const meta = await import("@/lib/sheets").then((m) =>
    m.getMetaValues(session.accessToken, session.sheetId)
  );
  const lastRun = meta.last_dedup_checked_at ? new Date(meta.last_dedup_checked_at).getTime() : 0;
  const RUN_INTERVAL_MS = 60 * 60 * 1000;

  if (Date.now() - lastRun < RUN_INTERVAL_MS) {
    return NextResponse.json({ skipped: true });
  }

  // Fire BG — returns immediately, dedup_running_at tracked in sheet
  runDuplicateDetection(session).catch(() => {});
  return NextResponse.json({ started: true });
});

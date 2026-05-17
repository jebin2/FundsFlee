import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { runDailyJobs } from "@/lib/cron/scheduler";
import { requestEmailImport } from "@/server/services/emailImportService";
import { runDuplicateDetection } from "@/server/services/duplicateDetectionService";

export const maxDuration = 300;

// POST /api/cron/run?job=all|email|dedup
// Manually triggers scheduled jobs with the current browser session —
// no need to read from the cron-session file.
export const POST = withSession("POST cron/run", async (session, req: NextRequest) => {
  const job = new URL(req.url).searchParams.get("job") ?? "all";

  if (job === "all") {
    // Use the scheduler's runDailyJobs which reads from the stored cron session.
    // For a UI-triggered run we want to use the live session instead, so call
    // each job directly.
    const results: Record<string, string> = {};

    try {
      requestEmailImport(session, { manual: true });
      results.email = "started";
    } catch {
      results.email = "failed";
    }

    try {
      await runDuplicateDetection(session);
      results.dedup = "done";
    } catch {
      results.dedup = "failed";
    }

    return NextResponse.json({ ok: true, results });
  }

  if (job === "email") {
    requestEmailImport(session, { manual: true });
    return NextResponse.json({ ok: true, job: "email", status: "started" });
  }

  if (job === "dedup") {
    await runDuplicateDetection(session);
    return NextResponse.json({ ok: true, job: "dedup", status: "done" });
  }

  return NextResponse.json({ error: "Unknown job" }, { status: 400 });
});

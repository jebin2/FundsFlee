import { NextRequest, NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { requestEmailImport } from "@/server/services/emailImportService";
import { runEmailImportJob } from "@/server/jobs/emailImportJob";
import { runDuplicateDetection } from "@/server/services/duplicateDetectionService";
import { log } from "@/lib/logger";

export const maxDuration = 300;

// POST /api/cron/run?job=all|email|dedup
// Manually triggers scheduled jobs with the current browser session —
// no need to read from the cron-session file.
export const POST = withSession("POST cron/run", async (session, req: NextRequest) => {
  const job = new URL(req.url).searchParams.get("job") ?? "all";

  if (job === "all") {
    log.info("cron", "manual run all — email then dedup (sequential)");
    const results: Record<string, string> = {};

    // Step 1 — email import (awaited so dedup only starts after it finishes)
    try {
      const r = await runEmailImportJob(session, { manual: true });
      results.email = `done (scanned=${r.scanned} imported=${r.imported} skipped=${r.skipped})`;
    } catch (err) {
      log.error("cron", "email import failed", err);
      results.email = "failed";
    }

    // Step 2 — duplicate detection
    try {
      await runDuplicateDetection(session);
      results.dedup = "done";
    } catch (err) {
      log.error("cron", "dedup failed", err);
      results.dedup = "failed";
    }

    log.info("cron", "manual run all complete", results);
    return NextResponse.json({ ok: true, results });
  }

  if (job === "email") {
    log.info("cron", "manual run email");
    requestEmailImport(session, { manual: true });
    return NextResponse.json({ ok: true, job: "email", status: "started (background)" });
  }

  if (job === "dedup") {
    log.info("cron", "manual run dedup");
    await runDuplicateDetection(session);
    return NextResponse.json({ ok: true, job: "dedup", status: "done" });
  }

  return NextResponse.json({ error: "Unknown job" }, { status: 400 });
});

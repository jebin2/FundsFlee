import { NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { getMetaValues } from "@/lib/sheets";
import { cronSessionExists } from "@/lib/cron/cronStore";

export const GET = withSession("GET cron/status", async (session) => {
  const meta = await getMetaValues(session.accessToken, session.sheetId);
  const dedupRunningAt = meta.dedup_running_at || null;
  const dedupStillRunning = dedupRunningAt
    ? Date.now() - new Date(dedupRunningAt).getTime() < 5 * 60 * 1000
    : false;

  return NextResponse.json({
    registered:    cronSessionExists(),
    email: {
      lastRun:     meta.email_import_last_run     ?? null,
      runningAt:   meta.email_import_running_at   ?? null,
      txCount:     parseInt(meta.email_import_tx_count ?? "0") || 0,
      enabled:     (meta.email_import_from_contains ? JSON.parse(meta.email_import_from_contains) : []).length > 0,
    },
    dedup: {
      lastRun:     meta.last_dedup_checked_at ?? null,
      runningAt:   dedupStillRunning ? dedupRunningAt : null,
    },
    schedule:      "12:00 IST daily",
  });
});

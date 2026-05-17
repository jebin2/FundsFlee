import { NextResponse } from "next/server";
import { withSession } from "@/server/http/withSession";
import { getMetaValues, getAnalysisCacheForPeriods } from "@/lib/sheets";
import { cronSessionExists } from "@/lib/cron/cronStore";

// A job is considered "still running" only if:
//  - its runningAt is within the staleness window, AND
//  - its lastRun (if any) is NOT more recent than runningAt
//    (lastRun > runningAt means the job finished after it started)
function isStillRunning(runningAt: string | null, lastRun: string | null, maxMs = 10 * 60 * 1000): boolean {
  if (!runningAt) return false;
  const age = Date.now() - new Date(runningAt).getTime();
  if (age >= maxMs) return false;                                        // stale — server restart leak
  if (lastRun && new Date(lastRun) > new Date(runningAt)) return false; // already finished
  return true;
}

export const GET = withSession("GET cron/status", async (session) => {
  const [meta, analysisByPeriod] = await Promise.all([
    getMetaValues(session.accessToken, session.sheetId),
    getAnalysisCacheForPeriods(session.accessToken, session.sheetId, ["week", "month", "year"]),
  ]);

  const emailRunningAt = meta.email_import_running_at || null;
  const emailLastRun   = meta.email_import_last_run   || null;
  const dedupRunningAt = meta.dedup_running_at         || null;
  const dedupLastRun   = meta.last_dedup_checked_at   || null;

  // Analysis: generated_at is set when the "generating" row is written, so it acts
  // as the start time. If it's older than 10 minutes the job is stuck.
  function analysisStuck(period: typeof analysisByPeriod[keyof typeof analysisByPeriod]) {
    if (!period || period.status !== "generating") return false;
    const ageMs = period.generated_at
      ? Date.now() - new Date(period.generated_at).getTime()
      : Infinity;
    return ageMs < 10 * 60 * 1000; // still within window → genuinely generating
  }

  return NextResponse.json({
    registered: cronSessionExists(),
    email: {
      lastRun:   emailLastRun,
      runningAt: isStillRunning(emailRunningAt, emailLastRun) ? emailRunningAt : null,
      txCount:   parseInt(meta.email_import_tx_count ?? "0") || 0,
      enabled:   (meta.email_import_from_contains ? JSON.parse(meta.email_import_from_contains) : []).length > 0,
    },
    dedup: {
      lastRun:   dedupLastRun,
      runningAt: isStillRunning(dedupRunningAt, dedupLastRun) ? dedupRunningAt : null,
    },
    analysis: {
      week:  { lastRun: analysisByPeriod.week?.generated_at  ?? null, status: analysisStuck(analysisByPeriod.week)  ? "generating" : analysisByPeriod.week?.status  ?? null },
      month: { lastRun: analysisByPeriod.month?.generated_at ?? null, status: analysisStuck(analysisByPeriod.month) ? "generating" : analysisByPeriod.month?.status ?? null },
      year:  { lastRun: analysisByPeriod.year?.generated_at  ?? null, status: analysisStuck(analysisByPeriod.year)  ? "generating" : analysisByPeriod.year?.status  ?? null },
    },
    schedule: "12:00 IST daily",
  });
});

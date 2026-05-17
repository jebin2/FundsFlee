import cron from "node-cron";
import { loadCronSession } from "./cronStore";
import { runEmailImportJob } from "@/server/jobs/emailImportJob";
import { runDuplicateDetection } from "@/server/services/duplicateDetectionService";
import { retryFailedMerges } from "@/server/jobs/mergeJob";
import { runAnalysisJob } from "@/server/jobs/analysisJob";
import { runComparisonJob } from "@/server/jobs/comparisonJob";
import { getAnalysisCacheRowsByStatus } from "@/lib/sheets/analysis-cache";
import { getAllTransactions, updateTransactionField, getMetaValues } from "@/lib/sheets";
import { log } from "@/lib/logger";
import { refreshGoogleToken } from "@/lib/googleAuth";
import type { SheetSession } from "@/server/services/types";

const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

// Mark transactions stuck in "processing" or "merging" as failed.
// A restart mid-job leaves these statuses permanently set — the cron cleans them up.
async function cleanupStuckTransactions(session: SheetSession): Promise<void> {
  const all = await getAllTransactions(session.accessToken, session.sheetId);
  const now = Date.now();
  const stuck = all.filter((t) => {
    if (t.status !== "processing" && t.status !== "merging") return false;
    const age = now - new Date(t.updated_at || t.created_at).getTime();
    return age >= STUCK_THRESHOLD_MS;
  });
  if (stuck.length === 0) return;
  log.info("cron", `cleanup: marking ${stuck.length} stuck transaction(s) as failed`);
  for (const tx of stuck) {
    const failedStatus = tx.status === "merging" ? "merge_failed" : "failed";
    await updateTransactionField(session.accessToken, session.sheetId, tx.id, { status: failedStatus })
      .catch((err) => log.error("cron", "cleanup: failed to mark tx", { id: tx.id, err }));
  }
}

export async function runDailyJobs(): Promise<{ email: string; dedup: string }> {
  const stored = loadCronSession();
  if (!stored) {
    log.warn("cron", "no credentials stored — open the app once to register");
    return { email: "skipped (not registered)", dedup: "skipped (not registered)" };
  }

  const accessToken = await refreshGoogleToken(stored.refreshToken);
  if (!accessToken) {
    log.error("cron", "failed to refresh Google access token");
    return { email: "failed (auth)", dedup: "failed (auth)" };
  }

  const session = {
    accessToken,
    refreshToken: stored.refreshToken,
    sheetId: stored.sheetId,
    userEmail: stored.userEmail,
  };

  // ── 0. Cleanup stuck transactions from previous server run ───────────────
  try {
    await cleanupStuckTransactions(session);
  } catch (err) {
    log.error("cron", "stuck-tx cleanup failed", err);
  }

  // ── 1. Email import ───────────────────────────────────────────────────────
  let emailResult = "ok";
  try {
    log.info("cron", "starting email import");
    await runEmailImportJob(session);
    log.info("cron", "email import done");
  } catch (err) {
    log.error("cron", "email import failed", err);
    emailResult = "failed";
  }

  // ── 2. Duplicate detection ────────────────────────────────────────────────
  let dedupResult = "ok";
  try {
    log.info("cron", "starting duplicate detection");
    await runDuplicateDetection(session);
    log.info("cron", "duplicate detection done");
  } catch (err) {
    log.error("cron", "duplicate detection failed", err);
    dedupResult = "failed";
  }

  // ── 3. Retry failed merges ────────────────────────────────────────────────
  try {
    await retryFailedMerges(session);
  } catch (err) {
    log.error("cron", "merge retry pass failed", err);
  }

  // ── 4. Analysis — week, month, year (sequential) ──────────────────────────
  const meta = await getMetaValues(session.accessToken, session.sheetId).catch(() => ({}) as Record<string, string>);
  const region = meta.region ?? "";
  const lifestyleTags: string[] = meta.lifestyle_tags ? JSON.parse(meta.lifestyle_tags ?? "[]") : [];

  for (const period of ["week", "month", "year"] as const) {
    try {
      log.info("cron", `starting analysis: ${period}`);
      await runAnalysisJob(session, period, region, lifestyleTags);
      log.info("cron", `analysis done: ${period}`);
    } catch (err) {
      log.error("cron", `analysis failed: ${period}`, err);
    }
  }

  // ── 5. Retry failed comparisons ───────────────────────────────────────────
  try {
    const failedRows = await getAnalysisCacheRowsByStatus(session.accessToken, session.sheetId, "failed");
    for (const row of failedRows.filter((r) => r.period.startsWith("compare_"))) {
      const parts = row.period.replace("compare_", "").split("_");
      const p = parts.pop() ?? "month";
      const merchants = parts.join("_").split("|");
      if (merchants.length >= 2) {
        log.info("cron", `retrying failed comparison: ${row.period}`);
        await runComparisonJob(session, merchants, p, region).catch((err) =>
          log.error("cron", "comparison retry failed", { period: row.period, err })
        );
      }
    }
  } catch (err) {
    log.error("cron", "comparison retry pass failed", err);
  }

  return { email: emailResult, dedup: dedupResult };
}

let initialized = false;

export function initCronScheduler(): void {
  if (initialized) return;
  initialized = true;

  // Daily at 12:00 IST
  cron.schedule("0 12 * * *", async () => {
    log.info("cron", "daily job triggered at 12:00 IST");
    await runDailyJobs();
  }, { timezone: "Asia/Kolkata" });

  log.info("cron", "scheduler initialised — daily at 12:00 IST");
}

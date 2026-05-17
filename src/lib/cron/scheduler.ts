import cron from "node-cron";
import { loadCronSession } from "./cronStore";
import { runEmailImportJob } from "@/server/jobs/emailImportJob";
import { runDuplicateDetection } from "@/server/services/duplicateDetectionService";
import { retryFailedMerges } from "@/server/jobs/mergeJob";
import { runAnalysisJob } from "@/server/jobs/analysisJob";
import { runComparisonJob } from "@/server/jobs/comparisonJob";
import { getAnalysisCacheRowsByStatus } from "@/lib/sheets/analysis-cache";
import { getMetaValues } from "@/lib/sheets";
import { log } from "@/lib/logger";
import { refreshGoogleToken } from "@/lib/googleAuth";

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

  // ── 4. Retry failed analyses ──────────────────────────────────────────────
  try {
    const meta = await getMetaValues(session.accessToken, session.sheetId);
    const region = meta.region ?? "";
    const lifestyleTags: string[] = meta.lifestyle_tags ? JSON.parse(meta.lifestyle_tags) : [];
    const failedAnalyses = await getAnalysisCacheRowsByStatus(session.accessToken, session.sheetId, "failed");
    for (const row of failedAnalyses) {
      if (row.period.startsWith("compare_")) {
        // Comparison cache row — extract merchants and period from the key
        const parts = row.period.replace("compare_", "").split("_");
        const period = parts.pop() ?? "month";
        const merchants = parts.join("_").split("|");
        if (merchants.length >= 2) {
          log.info("cron", `retrying failed comparison: ${row.period}`);
          await runComparisonJob(session, merchants, period, region).catch((err) =>
            log.error("cron", "comparison retry failed", { period: row.period, err })
          );
        }
      } else {
        log.info("cron", `retrying failed analysis: ${row.period}`);
        await runAnalysisJob(session, row.period, region, lifestyleTags).catch((err) =>
          log.error("cron", "analysis retry failed", { period: row.period, err })
        );
      }
    }
  } catch (err) {
    log.error("cron", "analysis/compare retry pass failed", err);
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

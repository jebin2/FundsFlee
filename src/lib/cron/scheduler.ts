import cron from "node-cron";
import { loadCronSession } from "./cronStore";
import { runEmailImportJob } from "@/server/jobs/emailImportJob";
import { runDuplicateDetection } from "@/server/services/duplicateDetectionService";
import { log } from "@/lib/logger";

async function refreshGoogleAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

export async function runDailyJobs(): Promise<{ email: string; dedup: string }> {
  const stored = loadCronSession();
  if (!stored) {
    log.warn("cron", "no credentials stored — open the app once to register");
    return { email: "skipped (not registered)", dedup: "skipped (not registered)" };
  }

  const accessToken = await refreshGoogleAccessToken(stored.refreshToken);
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

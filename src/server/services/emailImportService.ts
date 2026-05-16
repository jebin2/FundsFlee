import { getMetaValues, setMetaValue } from "@/lib/sheets";
import { runEmailImportJob } from "@/server/jobs/emailImportJob";
import { safeJsonParse } from "@/lib/safeJson";
import type { SheetSession } from "./types";

export type EmailImportConfigUpdate = {
  enabled?: boolean;
  fromContains?: string[];
  daysBack?: number;
};

export async function saveEmailImportConfig(
  session: SheetSession,
  update: EmailImportConfigUpdate
): Promise<void> {
  const writes: Promise<void>[] = [];

  if (update.enabled !== undefined) {
    writes.push(setMetaValue(session.accessToken, session.sheetId, "email_import_enabled", String(update.enabled)));
  }
  if (update.fromContains !== undefined) {
    writes.push(setMetaValue(session.accessToken, session.sheetId, "email_import_from_contains", JSON.stringify(update.fromContains)));
  }
  if (update.daysBack !== undefined) {
    writes.push(setMetaValue(session.accessToken, session.sheetId, "email_import_days_back", String(update.daysBack)));
  }

  await Promise.all(writes);
}

export async function getEmailImportStatus(session: SheetSession) {
  const meta = await getMetaValues(session.accessToken, session.sheetId);
  return {
    enabled: meta.email_import_enabled === "true",
    fromContains: safeJsonParse<string[]>(meta.email_import_from_contains ?? null, []),
    daysBack: meta.email_import_days_back ? parseInt(meta.email_import_days_back) : 7,
    lastRun: meta.email_import_last_run ?? null,
    totalTxImported: parseInt(meta.email_import_tx_count ?? "0") || 0,
    runningAt: meta.email_import_running_at || null,
  };
}

// Trigger the email import job as a fire-and-forget background task.
// Returns immediately; job runs asynchronously.
export function requestEmailImport(session: SheetSession): void {
  runEmailImportJob(session).catch((err) => {
    console.error("Email import job failed:", err);
  });
}

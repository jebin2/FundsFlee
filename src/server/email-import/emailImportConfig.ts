import { getMetaValues } from "@/lib/sheets";
import { safeJsonParse } from "@/lib/safeJson";
import type { SheetSession } from "@/server/services/types";

export interface EmailImportConfig {
  fromContains: string[];
  daysBack: number;
  region: string;
  lastRun?: string;
  txCount: number;
  runningAt?: string;
}

export async function readEmailImportConfig(session: SheetSession): Promise<EmailImportConfig> {
  const meta = await getMetaValues(session.accessToken, session.sheetId);
  return {
    fromContains: safeJsonParse<string[]>(meta.email_import_from_contains ?? null, []),
    daysBack: meta.email_import_days_back ? parseInt(meta.email_import_days_back) : 7,
    region: meta.region ?? "",
    lastRun: meta.email_import_last_run || undefined,
    txCount: parseInt(meta.email_import_tx_count ?? "0") || 0,
    runningAt: meta.email_import_running_at || undefined,
  };
}

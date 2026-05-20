import { Readable } from "stream";
import { google } from "googleapis";
import { getSheetsClient, getDriveClient } from "./client";
import { getOrCreateReceiptsFolder } from "./drive";
import { todayISO } from "@/lib/date/iso";

// ── Analysis Cache ────────────────────────────────────────────────────────────
// Columns: A=id B=period C=period_type D=summary_json E=generated_at F=status G=drive_file_id

export type AnalysisCacheStatus = "generating" | "done" | "failed" | "cancelled";

export interface CachedAnalysis {
  id: string;
  period: string;
  period_type: string;
  summary_json: string;
  generated_at: string;
  status: AnalysisCacheStatus;
  drive_file_id?: string;
}

// If JSON is larger than this, store it in Drive instead of the cell
const ANALYSIS_CELL_LIMIT = 40000;

async function readAnalysisCacheRows(sheets: ReturnType<typeof google.sheets>, sheetId: string) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "analysis_cache!A2:G200",
  });
  return res.data.values ?? [];
}

function rowToCachedAnalysis(row: string[]): CachedAnalysis {
  return {
    id: row[0],
    period: row[1],
    period_type: row[2],
    summary_json: row[3] ?? "",
    generated_at: row[4] ?? "",
    status: (row[5] as AnalysisCacheStatus) || "done",
    drive_file_id: row[6] || undefined,
  };
}

export async function getAnalysisCache(
  accessToken: string,
  sheetId: string,
  period: string,
  maxAgeHours = 24
): Promise<CachedAnalysis | null> {
  const sheets = getSheetsClient(accessToken);
  const rows = await readAnalysisCacheRows(sheets, sheetId);

  // For "generating" entries, always return regardless of TTL so client can poll
  const generating = rows.find((r) => r[1] === period && r[5] === "generating");
  if (generating) return rowToCachedAnalysis(generating);

  const cutoff = isFinite(maxAgeHours)
    ? new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString()
    : "0000-00-00";
  const row = rows.find((r) => r[1] === period && r[5] === "done" && r[4] >= cutoff);
  if (!row) {
    // Check for failed entry (return without TTL)
    const failed = rows.find((r) => r[1] === period && r[5] === "failed");
    if (failed) return rowToCachedAnalysis(failed);
    return null;
  }

  return rowToCachedAnalysis(row);
}

export async function upsertAnalysisCacheRow(
  accessToken: string,
  sheetId: string,
  period: string,
  periodType: string,
  status: AnalysisCacheStatus,
  summaryJson = "",
  driveFileId = ""
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  const rows = await readAnalysisCacheRows(sheets, sheetId);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const idx = rows.findIndex((r) => r[1] === period);
  const values = [[id, period, periodType, summaryJson, now, status, driveFileId]];

  if (idx >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `analysis_cache!A${idx + 2}:G${idx + 2}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "analysis_cache!A2",
      valueInputOption: "RAW",
      requestBody: { values },
    });
  }
}

export async function storeAnalysisInDrive(
  accessToken: string,
  sheetId: string,
  period: string,
  jsonContent: string
): Promise<string> {
  const drive = getDriveClient(accessToken);
  const folderId = await getOrCreateReceiptsFolder(accessToken, sheetId);
  const filename = `analysis_${period}_${todayISO()}.json`;
  const file = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: "application/json", body: Readable.from(Buffer.from(jsonContent)) },
    fields: "id",
  });
  return file.data.id!;
}

export async function getAnalysisFromDrive(
  accessToken: string,
  fileId: string
): Promise<string> {
  const drive = getDriveClient(accessToken);
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer).toString("utf-8");
}

// Return cache entries for multiple periods in one read (used by cron/status)
export async function getAnalysisCacheForPeriods(
  accessToken: string,
  sheetId: string,
  periods: string[]
): Promise<Record<string, CachedAnalysis | null>> {
  const sheets = getSheetsClient(accessToken);
  const rows = await readAnalysisCacheRows(sheets, sheetId);
  const result: Record<string, CachedAnalysis | null> = {};
  for (const period of periods) {
    const row = rows.find((r) => r[1] === period);
    result[period] = row ? rowToCachedAnalysis(row) : null;
  }
  return result;
}

// Return all cache rows with a given status (used by cron retry)
export async function getAnalysisCacheRowsByStatus(
  accessToken: string,
  sheetId: string,
  status: AnalysisCacheStatus
): Promise<CachedAnalysis[]> {
  const sheets = getSheetsClient(accessToken);
  const rows = await readAnalysisCacheRows(sheets, sheetId);
  return rows.filter((r) => r[5] === status).map(rowToCachedAnalysis);
}

// Keep backward-compat alias used in a few places
export async function saveAnalysisCache(
  accessToken: string,
  sheetId: string,
  period: string,
  periodType: string,
  summaryJson: string
): Promise<void> {
  const needsDrive = summaryJson.length > ANALYSIS_CELL_LIMIT;
  let driveFileId = "";
  let cellJson = summaryJson;

  if (needsDrive) {
    driveFileId = await storeAnalysisInDrive(accessToken, sheetId, period, summaryJson);
    cellJson = "";
  }

  await upsertAnalysisCacheRow(accessToken, sheetId, period, periodType, "done", cellJson, driveFileId);
}

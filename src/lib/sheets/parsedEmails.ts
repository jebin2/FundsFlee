import { getSheetsClient, withSheetsRetry } from "./client";

// ── parsed_emails sheet ───────────────────────────────────────────────────────
// Columns: email_id | from | subject | parsed_at | status | tx_ids
// status: "parsed" | "skipped" | "failed"
// tx_ids: comma-separated transaction IDs (empty for skipped/failed)

export type ParsedEmailStatus = "parsed" | "skipped" | "failed";

export interface ParsedEmailRecord {
  emailId: string;
  from: string;
  subject: string;
  parsedAt: string;
  status: ParsedEmailStatus;
  txIds: string[];
}

const RANGE = "parsed_emails!A2:F";
const COLS = { emailId: 0, from: 1, subject: 2, parsedAt: 3, status: 4, txIds: 5 };

async function getAllRows(sheets: ReturnType<typeof getSheetsClient>, sheetId: string): Promise<string[][]> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: RANGE });
  return (res.data.values ?? []) as string[][];
}

// Load ALL processed email IDs into a Set — call ONCE per job run,
// then check Set.has() in memory instead of hitting the Sheets API per email.
export async function getProcessedEmailIds(
  accessToken: string,
  sheetId: string
): Promise<Set<string>> {
  const sheets = getSheetsClient(accessToken);
  const rows = await getAllRows(sheets, sheetId);
  return new Set(rows.map((r) => r[COLS.emailId]).filter(Boolean));
}

// Returns true if this email has already been processed (any status).
// Prefer getProcessedEmailIds() in loops to avoid N+1 Sheets API calls.
export async function checkEmailParsed(
  accessToken: string,
  sheetId: string,
  emailId: string
): Promise<boolean> {
  const sheets = getSheetsClient(accessToken);
  const rows = await getAllRows(sheets, sheetId);
  return rows.some((r) => r[COLS.emailId] === emailId);
}

// Write a processing result for one email.
export async function recordParsedEmail(
  accessToken: string,
  sheetId: string,
  record: ParsedEmailRecord
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  const row = [
    record.emailId,
    record.from.slice(0, 100),
    record.subject.slice(0, 150),
    record.parsedAt,
    record.status,
    record.txIds.join(","),
  ];
  await withSheetsRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "parsed_emails!A2",
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    })
  );
}

// Returns stats for the status display in settings.
export async function getParsedEmailStats(
  accessToken: string,
  sheetId: string
): Promise<{ total: number; parsed: number; skipped: number; failed: number }> {
  const sheets = getSheetsClient(accessToken);
  const rows = await getAllRows(sheets, sheetId);
  const parsed  = rows.filter((r) => r[COLS.status] === "parsed").length;
  const skipped = rows.filter((r) => r[COLS.status] === "skipped").length;
  const failed  = rows.filter((r) => r[COLS.status] === "failed").length;
  return { total: rows.length, parsed, skipped, failed };
}

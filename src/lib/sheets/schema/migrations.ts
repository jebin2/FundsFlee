import { google } from "googleapis";
import { getSheetsClient } from "../client";
import { EXPECTED_HEADERS, PARSED_EMAILS_HEADERS } from "./headers";

const schemaChecked = new Set<string>();
const parsedEmailsTabChecked = new Set<string>();

export async function ensureParsedEmailsTab(
  sheets: ReturnType<typeof getSheetsClient>,
  sheetId: string
): Promise<void> {
  if (parsedEmailsTabChecked.has(sheetId)) return;

  try {
    await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: "parsed_emails!A1" });
    parsedEmailsTabChecked.add(sheetId);
    return;
  } catch {
    // Tab doesn't exist yet — fall through to create it
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: "parsed_emails" } } }] },
  }).catch(() => {});

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "parsed_emails!A1:F1",
    valueInputOption: "RAW",
    requestBody: { values: [Array.from(PARSED_EMAILS_HEADERS)] },
  }).catch(() => {});

  parsedEmailsTabChecked.add(sheetId);
}

export async function ensureTransactionSchema(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string
): Promise<void> {
  if (schemaChecked.has(sheetId)) return;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "transactions!A1:Z1",
  });
  const current = (res.data.values?.[0] ?? []) as string[];
  if (current.length >= EXPECTED_HEADERS.length) {
    schemaChecked.add(sheetId);
    return;
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "transactions!A1:Z1",
    valueInputOption: "RAW",
    requestBody: { values: [Array.from(EXPECTED_HEADERS)] },
  });
  schemaChecked.add(sheetId);
}

import { getDriveClient, getSheetsClient } from "./client";
import { EXPECTED_HEADERS, CATEGORIES_HEADERS, ANALYSIS_CACHE_HEADERS, ITEM_SUGGESTIONS_HEADERS, META_HEADERS, PARSED_EMAILS_HEADERS } from "./schema/headers";
import { seedDefaultCategories } from "./schema/defaultCategories";
import { ensureTransactionSchema, ensureParsedEmailsTab } from "./schema/migrations";

// appProperties are tied to our OAuth client ID — invisible in Drive UI,
// survives renames/moves, and is the authoritative app identifier.
const APP_PROP_KEY = "fundsFleeRole";
const APP_SHEET_ROLE = "main";
const SHEET_DISPLAY_NAME = "FundsFlee";

export { EXPECTED_HEADERS } from "./schema/headers";
export { ensureParsedEmailsTab, ensureTransactionSchema } from "./schema/migrations";
export { seedDefaultCategories } from "./schema/defaultCategories";

export async function initSpendingSheet(
  accessToken: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userName: string
): Promise<{ sheetId: string; sheetUrl: string; isNew: boolean }> {
  const drive = getDriveClient(accessToken);
  const sheets = getSheetsClient(accessToken);

  // Look up by appProperties — works even if the user renames the sheet
  const existing = await drive.files.list({
    q: `appProperties has { key='${APP_PROP_KEY}' and value='${APP_SHEET_ROLE}' } and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: "files(id,webViewLink)",
    spaces: "drive",
    pageSize: 1,
  });

  if (existing.data.files && existing.data.files.length > 0) {
    const file = existing.data.files[0];
    const sheetId = file.id!;
    const sheetUrl = file.webViewLink
      ?? `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    await ensureTransactionSchema(sheets, sheetId).catch(() => {});
    await ensureParsedEmailsTab(sheets, sheetId).catch(() => {});
    return { sheetId, sheetUrl, isNew: false };
  }

  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: SHEET_DISPLAY_NAME },
      sheets: [
        { properties: { title: "transactions" } },
        { properties: { title: "categories" } },
        { properties: { title: "analysis_cache" } },
        { properties: { title: "item_suggestions" } },
        { properties: { title: "meta" } },
        { properties: { title: "parsed_emails" } },
      ],
    },
  });

  const sheetId = spreadsheet.data.spreadsheetId!;
  const sheetUrl = spreadsheet.data.spreadsheetUrl
    ?? `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

  // Stamp the appProperty so future lookups use it instead of the name
  await drive.files.update({
    fileId: sheetId,
    requestBody: { appProperties: { [APP_PROP_KEY]: APP_SHEET_ROLE } },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "transactions!A1:Z1",
    valueInputOption: "RAW",
    requestBody: { values: [Array.from(EXPECTED_HEADERS)] },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "categories!A1:G1",
    valueInputOption: "RAW",
    requestBody: { values: [Array.from(CATEGORIES_HEADERS)] },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "analysis_cache!A1:G1",
    valueInputOption: "RAW",
    requestBody: { values: [Array.from(ANALYSIS_CACHE_HEADERS)] },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "item_suggestions!A1:G1",
    valueInputOption: "RAW",
    requestBody: { values: [Array.from(ITEM_SUGGESTIONS_HEADERS)] },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "meta!A1:B1",
    valueInputOption: "RAW",
    requestBody: { values: [Array.from(META_HEADERS)] },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "parsed_emails!A1:F1",
    valueInputOption: "RAW",
    requestBody: { values: [Array.from(PARSED_EMAILS_HEADERS)] },
  });

  await seedDefaultCategories(sheets, sheetId);

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "meta!A2",
    valueInputOption: "RAW",
    requestBody: { values: [["sheet_url", sheetUrl]] },
  });

  return { sheetId, sheetUrl, isNew: true };
}

export async function resetSheet(
  accessToken: string,
  sheetId: string
): Promise<void> {
  const sheets = getSheetsClient(accessToken);

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: sheetId,
    requestBody: {
      ranges: [
        "transactions!A2:Z",
        "categories!A2:G",
        "analysis_cache!A2:G",
        "item_suggestions!A2:G",
        "parsed_emails!A2:F",
        "meta!A2:B",
      ],
    },
  });

  const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  await Promise.all([
    seedDefaultCategories(sheets, sheetId),
    sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "meta!A2",
      valueInputOption: "RAW",
      requestBody: { values: [["sheet_url", sheetUrl]] },
    }),
  ]);
}

import { google } from "googleapis";
import { getSheetsClient, getDriveClient } from "./client";

// appProperties are tied to our OAuth client ID — invisible in Drive UI,
// survives renames/moves, and is the authoritative app identifier.
const APP_PROP_KEY = "fundsFleeRole";
const APP_SHEET_ROLE = "main";
const SHEET_DISPLAY_NAME = "FundsFlee";

export const EXPECTED_HEADERS = [
  "id", "date", "time", "amount", "original_amount", "original_currency",
  "merchant", "category", "subcategory", "item_name", "payment_method",
  "tags", "notes", "source", "raw_input", "location",
  "is_duplicate", "duplicate_ref", "created_at", "updated_at",
  "status", "receipt_url", "receipt_id", "quantity", "deleted", "recurrence",
];

// Per-sheetId cache — avoids re-fetching the header row on every appendTransaction()
const schemaChecked = new Set<string>();

export async function ensureTransactionSchema(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string
) {
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
  // Write full header row
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "transactions!A1:Z1",
    valueInputOption: "RAW",
    requestBody: { values: [EXPECTED_HEADERS] },
  });
  schemaChecked.add(sheetId);
}

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
    // Migrate header for existing sheets (adds receipt_id, quantity, deleted if missing)
    await ensureTransactionSchema(sheets, sheetId).catch(() => {});
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

  // Headers — 26 columns (A–Z)
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "transactions!A1:Z1",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        "id", "date", "time", "amount", "original_amount", "original_currency",
        "merchant", "category", "subcategory", "item_name", "payment_method",
        "tags", "notes", "source", "raw_input", "location",
        "is_duplicate", "duplicate_ref", "created_at", "updated_at",
        "status", "receipt_url", "receipt_id", "quantity", "deleted", "recurrence",
      ]],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "categories!A1:G1",
    valueInputOption: "RAW",
    requestBody: {
      values: [["id", "name", "parent_id", "color", "icon", "is_default", "created_at"]],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "analysis_cache!A1:E1",
    valueInputOption: "RAW",
    requestBody: {
      values: [["id", "period", "period_type", "summary_json", "generated_at", "status", "drive_file_id"]],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "item_suggestions!A1:G1",
    valueInputOption: "RAW",
    requestBody: { values: [["key", "field", "current_val", "suggested", "source", "status", "updated_at"]] },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "meta!A1:B1",
    valueInputOption: "RAW",
    requestBody: { values: [["key", "value"]] },
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

export async function seedDefaultCategories(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string
) {
  const defaults = [
    { name: "Food & Dining", icon: "🍽️", color: "#FF6B6B", subs: ["Restaurants", "Cafes", "Swiggy/Zomato", "Groceries"] },
    { name: "Transport", icon: "🚗", color: "#4ECDC4", subs: ["Ola/Uber", "Fuel", "Auto", "Bus/Train", "Flight"] },
    { name: "Shopping", icon: "🛍️", color: "#45B7D1", subs: ["Clothing", "Electronics", "Household", "Online"] },
    { name: "Entertainment", icon: "🎬", color: "#96CEB4", subs: ["Movies", "OTT", "Events", "Games"] },
    { name: "Health", icon: "🏥", color: "#FFEAA7", subs: ["Pharmacy", "Doctor", "Gym", "Lab Tests"] },
    { name: "Bills & Utilities", icon: "⚡", color: "#DDA0DD", subs: ["Electricity", "Mobile", "Internet", "Rent", "EMI"] },
    { name: "Education", icon: "📚", color: "#98D8C8", subs: ["Books", "Courses", "School"] },
    { name: "Personal Care", icon: "💆", color: "#F7DC6F", subs: ["Salon", "Spa"] },
    { name: "Gifts & Donations", icon: "🎁", color: "#BB8FCE", subs: [] },
    { name: "Others", icon: "📦", color: "#AED6F1", subs: [] },
  ];

  const rows: string[][] = [];
  const now = new Date().toISOString();

  for (const cat of defaults) {
    const parentId = crypto.randomUUID();
    rows.push([parentId, cat.name, "", cat.color, cat.icon, "true", now]);
    for (const sub of cat.subs) {
      rows.push([crypto.randomUUID(), sub, parentId, cat.color, cat.icon, "true", now]);
    }
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "categories!A2",
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

// ── Reset ─────────────────────────────────────────────────────────────────────

export async function resetSheet(
  accessToken: string,
  sheetId: string
): Promise<void> {
  const sheets = getSheetsClient(accessToken);

  // Clear data from all tabs (keep header rows)
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: sheetId,
    requestBody: {
      ranges: [
        "transactions!A2:Z",
        "categories!A2:G",
        "analysis_cache!A2:G",
        "item_suggestions!A2:G",
        "meta!A2:B",
      ],
    },
  });

  // Re-seed categories and restore sheet_url in meta
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

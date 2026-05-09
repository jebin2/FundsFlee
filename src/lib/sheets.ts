import { google } from "googleapis";
import { Readable } from "stream";
import type { Transaction, Category, TransactionStatus } from "@/types";

// Columns A–Y (25 total)
// A=id B=date C=time D=amount E=original_amount F=original_currency
// G=merchant H=category I=subcategory J=item_name K=payment_method
// L=tags M=notes N=source O=raw_input P=location
// Q=is_duplicate R=duplicate_ref S=created_at T=updated_at
// U=status V=receipt_url W=receipt_id X=quantity Y=deleted

function getAuth(accessToken: string) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

function getSheetsClient(accessToken: string) {
  return google.sheets({ version: "v4", auth: getAuth(accessToken) });
}

function getDriveClient(accessToken: string) {
  return google.drive({ version: "v3", auth: getAuth(accessToken) });
}

// ── Sheet Init ────────────────────────────────────────────────────────────────

// appProperties are tied to our OAuth client ID — invisible in Drive UI,
// survives renames/moves, and is the authoritative app identifier.
const APP_PROP_KEY = "spendingTrackerRole";
const APP_SHEET_ROLE = "main";
const APP_FOLDER_ROLE = "receipts";
const SHEET_DISPLAY_NAME = "SpendingTracker";
const FOLDER_DISPLAY_NAME = "SpendingTracker Receipts";

const EXPECTED_HEADERS = [
  "id", "date", "time", "amount", "original_amount", "original_currency",
  "merchant", "category", "subcategory", "item_name", "payment_method",
  "tags", "notes", "source", "raw_input", "location",
  "is_duplicate", "duplicate_ref", "created_at", "updated_at",
  "status", "receipt_url", "receipt_id", "quantity", "deleted",
];

async function ensureTransactionSchema(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string
) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "transactions!A1:Y1",
  });
  const current = (res.data.values?.[0] ?? []) as string[];
  if (current.length >= EXPECTED_HEADERS.length) return; // already up to date
  // Write full header row
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "transactions!A1:Y1",
    valueInputOption: "RAW",
    requestBody: { values: [EXPECTED_HEADERS] },
  });
}

export async function initSpendingSheet(
  accessToken: string,
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

  // Headers — 25 columns (A–Y)
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "transactions!A1:Y1",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        "id", "date", "time", "amount", "original_amount", "original_currency",
        "merchant", "category", "subcategory", "item_name", "payment_method",
        "tags", "notes", "source", "raw_input", "location",
        "is_duplicate", "duplicate_ref", "created_at", "updated_at",
        "status", "receipt_url", "receipt_id", "quantity", "deleted",
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

async function seedDefaultCategories(
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

// ── Transactions ──────────────────────────────────────────────────────────────

export async function appendTransaction(
  accessToken: string,
  sheetId: string,
  tx: Transaction
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  await ensureTransactionSchema(sheets, sheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "transactions!A2",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        tx.id, tx.date, tx.time, tx.amount,
        tx.original_amount ?? "", tx.original_currency ?? "",
        tx.merchant, tx.category, tx.subcategory ?? "",
        tx.item_name ?? "", tx.payment_method,
        (tx.tags ?? []).join(","), tx.notes ?? "",
        tx.source, tx.raw_input ?? "", tx.location ?? "",
        tx.is_duplicate ? "TRUE" : "FALSE", tx.duplicate_ref ?? "",
        tx.created_at, tx.updated_at,
        tx.status ?? "done", tx.receipt_url ?? "", tx.receipt_id ?? "", tx.quantity ?? "",
        tx.deleted ? "TRUE" : "",
      ]],
    },
  });
}

export async function getTransactions(
  accessToken: string,
  sheetId: string,
  limit = 500
): Promise<Transaction[]> {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `transactions!A2:Y${limit + 1}`,
  });

  const rows = res.data.values ?? [];
  return rows
    .filter((r) => r[0])
    .filter((r) => r[24] !== "TRUE" && r[12] !== "__DELETED__") // exclude deleted (new col Y + legacy notes)
    .map((r) => ({
      id: r[0], date: r[1] ?? "", time: r[2] ?? "",
      amount: parseFloat(r[3]) || 0,
      original_amount: r[4] ? parseFloat(r[4]) : undefined,
      original_currency: r[5] || undefined,
      merchant: r[6] ?? "", category: r[7] ?? "", subcategory: r[8] || undefined,
      item_name: r[9] || undefined,
      payment_method: (r[10] as Transaction["payment_method"]) ?? "Other",
      tags: r[11] ? r[11].split(",").filter(Boolean) : undefined,
      notes: r[12] || undefined,
      source: (r[13] as Transaction["source"]) ?? "manual",
      raw_input: r[14] || undefined,
      location: r[15] || undefined,
      is_duplicate: r[16] === "TRUE",
      duplicate_ref: r[17] || undefined,
      created_at: r[18] ?? "", updated_at: r[19] ?? "",
      status: (r[20] as TransactionStatus) || "done",
      receipt_url: r[21] || undefined,
      receipt_id: r[22] || undefined,
      quantity: r[23] || undefined,
    }));
}

function tryParseJSON(s: string) {
  try { return JSON.parse(s); } catch { return undefined; }
}

export async function getTransactionById(
  accessToken: string,
  sheetId: string,
  txId: string
): Promise<Transaction | null> {
  const all = await getTransactions(accessToken, sheetId);
  return all.find((t) => t.id === txId) ?? null;
}

export async function getCategories(
  accessToken: string,
  sheetId: string
): Promise<{ id: string; name: string; parent_id?: string; color: string; icon: string; is_default: boolean; created_at: string }[]> {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "categories!A2:G200",
  });

  const rows = res.data.values ?? [];
  return rows.filter((r) => r[0]).map((r) => ({
    id: r[0], name: r[1], parent_id: r[2] || undefined,
    color: r[3], icon: r[4], is_default: r[5] === "true", created_at: r[6],
  }));
}

export async function updateTransactionField(
  accessToken: string,
  sheetId: string,
  txId: string,
  updates: Partial<Transaction>
): Promise<void> {
  const sheets = getSheetsClient(accessToken);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "transactions!A2:A5000",
  });

  const rows = res.data.values ?? [];
  const rowIndex = rows.findIndex((r) => r[0] === txId);
  if (rowIndex < 0) return;

  const sheetRow = rowIndex + 2;
  const now = new Date().toISOString();

  const fieldMap: Record<string, string> = {
    date: "B", time: "C", amount: "D", original_amount: "E",
    original_currency: "F", merchant: "G", category: "H", subcategory: "I",
    item_name: "J", payment_method: "K", tags: "L", notes: "M", source: "N",
    raw_input: "O", location: "P", is_duplicate: "Q", duplicate_ref: "R",
    updated_at: "T", status: "U", receipt_url: "V", receipt_id: "W", quantity: "X",
    deleted: "Y",
  };

  const batchData: { range: string; values: unknown[][] }[] = [];
  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in updates || key === "updated_at") {
      let val: unknown = key === "updated_at" ? now : updates[key as keyof Transaction];
      if (key === "is_duplicate") val = val ? "TRUE" : "FALSE";
      if (key === "deleted") val = val ? "TRUE" : "";
      if (key === "tags" && Array.isArray(val)) val = (val as string[]).join(",");
      batchData.push({ range: `transactions!${col}${sheetRow}`, values: [[val ?? ""]] });
    }
  }

  if (batchData.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: "RAW", data: batchData },
    });
  }
}

// ── Meta ──────────────────────────────────────────────────────────────────────

export async function getMetaValues(
  accessToken: string,
  sheetId: string
): Promise<Record<string, string>> {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "meta!A2:B100",
  });

  const rows = res.data.values ?? [];
  return Object.fromEntries(rows.filter((r) => r[0]).map((r) => [r[0], r[1] ?? ""]));
}

export async function setMetaValue(
  accessToken: string,
  sheetId: string,
  key: string,
  value: string
): Promise<void> {
  const sheets = getSheetsClient(accessToken);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "meta!A2:A100",
  });

  const rows = res.data.values ?? [];
  const rowIndex = rows.findIndex((r) => r[0] === key);

  if (rowIndex >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `meta!B${rowIndex + 2}`,
      valueInputOption: "RAW",
      requestBody: { values: [[value]] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "meta!A2",
      valueInputOption: "RAW",
      requestBody: { values: [[key, value]] },
    });
  }
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
        "transactions!A2:Y",
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

// ── Drive / Receipts ──────────────────────────────────────────────────────────

export async function getOrCreateReceiptsFolder(
  accessToken: string,
  sheetId: string
): Promise<string> {
  const drive = getDriveClient(accessToken);
  const meta = await getMetaValues(accessToken, sheetId);

  if (meta.receipts_folder_id) return meta.receipts_folder_id;

  // Look up by appProperties first — survives renames
  const existing = await drive.files.list({
    q: `appProperties has { key='${APP_PROP_KEY}' and value='${APP_FOLDER_ROLE}' } and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
    spaces: "drive",
    pageSize: 1,
  });

  let folderId: string;
  if (existing.data.files && existing.data.files.length > 0) {
    folderId = existing.data.files[0].id!;
  } else {
    const folder = await drive.files.create({
      requestBody: {
        name: FOLDER_DISPLAY_NAME,
        mimeType: "application/vnd.google-apps.folder",
        appProperties: { [APP_PROP_KEY]: APP_FOLDER_ROLE },
      },
      fields: "id",
    });
    folderId = folder.data.id!;
  }

  await setMetaValue(accessToken, sheetId, "receipts_folder_id", folderId);
  return folderId;
}

export async function uploadReceiptToDrive(
  accessToken: string,
  folderId: string,
  imageBuffer: Buffer,
  filename: string,
  mimeType: string
): Promise<{ fileId: string; viewUrl: string }> {
  const drive = getDriveClient(accessToken);

  const file = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(imageBuffer),
    },
    fields: "id,webViewLink",
  });

  const fileId = file.data.id!;
  const viewUrl = file.data.webViewLink
    ?? `https://drive.google.com/file/d/${fileId}/view`;

  return { fileId, viewUrl };
}

export async function downloadReceiptFromDrive(
  accessToken: string,
  fileId: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const drive = getDriveClient(accessToken);

  // Get file metadata for mimeType
  const meta = await drive.files.get({ fileId, fields: "mimeType" });
  const mimeType = meta.data.mimeType ?? "image/jpeg";

  // Download content
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );

  return {
    buffer: Buffer.from(res.data as ArrayBuffer),
    mimeType,
  };
}

// ── Analysis Cache ────────────────────────────────────────────────────────────
// Columns: A=id B=period C=period_type D=summary_json E=generated_at F=status G=drive_file_id

export type AnalysisCacheStatus = "generating" | "done" | "failed";

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
  const filename = `analysis_${period}_${new Date().toISOString().split("T")[0]}.json`;
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

// ── Item Suggestions ──────────────────────────────────────────────────────────

// ── Item Suggestions ──────────────────────────────────────────────────────────
// Schema: key | field | current_val | suggested | source | status | updated_at
//
// key   = "tx:{transaction_id}" always — the representative or exact transaction row
// field = which Transaction field is being suggested (item_name | quantity | merchant)
// current_val = existing value in that field
// suggested   = AI-proposed replacement
// source = "normalize" → one row per unique item name (key = any tx with that name)
//                         accepting updates ALL transactions with matching current_val
//        = "notes"     → one row per transaction (key = that tx's id)
//                         accepting updates only that transaction
// status = pending | accepted | rejected
// updated_at = ISO timestamp of last status change

export type SuggestionStatus = "pending" | "processing" | "accepted" | "rejected";
export type SuggestionField = "item_name" | "quantity" | "merchant";
export type SuggestionSource = "normalize" | "notes";

export interface ItemSuggestion {
  key: string;
  field: SuggestionField;
  current_val: string;
  suggested: string;
  source: SuggestionSource;
  status: SuggestionStatus;
  updated_at: string;
}

async function ensureItemSuggestionsTab(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string
): Promise<void> {
  // Check if tab exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets.properties.title" });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === "item_suggestions");
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: "item_suggestions" } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "item_suggestions!A1:G1",
    valueInputOption: "RAW",
    requestBody: { values: [["key", "field", "current_val", "suggested", "source", "status", "updated_at"]] },
  });
}

async function readSuggestionRows(sheets: ReturnType<typeof google.sheets>, sheetId: string) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "item_suggestions!A2:G1000",
    });
    return res.data.values ?? [];
  } catch (err: unknown) {
    const msg = (err as { cause?: { message?: string } }).cause?.message ?? "";
    if (msg.includes("Unable to parse range") || msg.includes("not found")) {
      await ensureItemSuggestionsTab(sheets, sheetId);
      return [];
    }
    throw err;
  }
}

export async function getItemSuggestions(
  accessToken: string,
  sheetId: string
): Promise<ItemSuggestion[]> {
  const sheets = getSheetsClient(accessToken);
  const rows = await readSuggestionRows(sheets, sheetId);
  return rows
    .filter((r) => r[0])
    .map((r) => ({
      key: r[0],
      field: (r[1] as SuggestionField) ?? "item_name",
      current_val: r[2] ?? "",
      suggested: r[3] ?? "",
      source: (r[4] as SuggestionSource) ?? "normalize",
      status: (r[5] as SuggestionStatus) ?? "pending",
      updated_at: r[6] ?? "",
    }));
}

export async function appendItemSuggestions(
  accessToken: string,
  sheetId: string,
  suggestions: Omit<ItemSuggestion, "status" | "updated_at">[]
): Promise<void> {
  if (suggestions.length === 0) return;
  const sheets = getSheetsClient(accessToken);

  // Dedup against existing — never overwrite an existing entry (any status)
  const rows = await readSuggestionRows(sheets, sheetId);
  const existingKeys = new Set(rows.map((r) => `${r[0]}::${r[1]}`));
  // For normalize rows, also dedup by current_val+field (key is a tx ID that may differ between runs)
  const existingNormalizeVals = new Set(
    rows.filter((r) => r[4] === "normalize").map((r) => `${r[2]?.toLowerCase()}::${r[1]}`)
  );
  const toAdd = suggestions.filter((s) => {
    if (existingKeys.has(`${s.key}::${s.field}`)) return false;
    if (s.source === "normalize" && existingNormalizeVals.has(`${s.current_val.toLowerCase()}::${s.field}`)) return false;
    return true;
  });
  if (toAdd.length === 0) return;

  const now = new Date().toISOString();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "item_suggestions!A2",
    valueInputOption: "RAW",
    requestBody: {
      values: toAdd.map((s) => [s.key, s.field, s.current_val, s.suggested, s.source, "pending", now]),
    },
  });
}

export async function resolveItemSuggestion(
  accessToken: string,
  sheetId: string,
  key: string,
  field: SuggestionField,
  status: SuggestionStatus
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  const rows = await readSuggestionRows(sheets, sheetId);
  const idx = rows.findIndex((r) => r[0] === key && r[1] === field);
  if (idx < 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `item_suggestions!F${idx + 2}:G${idx + 2}`,
    valueInputOption: "RAW",
    requestBody: { values: [[status, new Date().toISOString()]] },
  });
}

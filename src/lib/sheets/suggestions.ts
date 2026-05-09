import { google } from "googleapis";
import { getSheetsClient } from "./client";

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

export async function ensureItemSuggestionsTab(
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

export async function readSuggestionRows(sheets: ReturnType<typeof google.sheets>, sheetId: string) {
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

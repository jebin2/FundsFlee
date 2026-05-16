import { getSheetsClient, withSheetsRetry } from "./client";

// ── Categories ────────────────────────────────────────────────────────────────

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
  return rows.filter((r) => r[0] && r[1]).map((r) => ({
    id: r[0], name: r[1], parent_id: r[2] || undefined,
    color: r[3], icon: r[4], is_default: r[5] === "true", created_at: r[6],
  }));
}

export async function appendCategory(
  accessToken: string,
  sheetId: string,
  cat: { id: string; name: string; color: string; icon: string; created_at: string }
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  await withSheetsRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "categories!A2",
      valueInputOption: "RAW",
      requestBody: { values: [[cat.id, cat.name, "", cat.color, cat.icon, "false", cat.created_at]] },
    })
  );
}

export async function deleteCategoryById(
  accessToken: string,
  sheetId: string,
  id: string
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "categories!A2:A200",
  });
  const rows = res.data.values ?? [];
  const rowIndex = rows.findIndex((r) => r[0] === id);
  if (rowIndex < 0) return;
  // Clear the name to soft-delete (row stays but is filtered out on read)
  await withSheetsRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `categories!A${rowIndex + 2}:G${rowIndex + 2}`,
      valueInputOption: "RAW",
      requestBody: { values: [["", "", "", "", "", "", ""]] },
    })
  );
}

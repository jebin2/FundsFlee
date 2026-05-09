import { getSheetsClient } from "./client";

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
  return rows.filter((r) => r[0]).map((r) => ({
    id: r[0], name: r[1], parent_id: r[2] || undefined,
    color: r[3], icon: r[4], is_default: r[5] === "true", created_at: r[6],
  }));
}

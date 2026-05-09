import { getSheetsClient } from "./client";

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

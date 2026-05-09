import type { Transaction, TransactionStatus } from "@/types";
import { getSheetsClient } from "./client";
import { ensureTransactionSchema } from "./init";

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

export async function getTransactionById(
  accessToken: string,
  sheetId: string,
  txId: string
): Promise<Transaction | null> {
  const all = await getTransactions(accessToken, sheetId);
  return all.find((t) => t.id === txId) ?? null;
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

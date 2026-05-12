import type { Transaction } from "@/types";
import { getSheetsClient } from "./client";
import { ensureTransactionSchema } from "./init";
import {
  transactionToRow,
  rowToTransaction,
  isDeletedRow,
  transactionUpdateToCells,
  DATA_RANGE,
  ID_RANGE,
} from "./transactionSchema";

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
    requestBody: { values: [transactionToRow(tx)] },
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
    range: DATA_RANGE(limit),
  });

  const rows = res.data.values ?? [];
  return rows
    .filter((r) => r[0])
    .filter((r) => !isDeletedRow(r as string[]))
    .map((r) => rowToTransaction(r as string[]));
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
    range: ID_RANGE,
  });

  const rows = res.data.values ?? [];
  const rowIndex = rows.findIndex((r) => r[0] === txId);
  if (rowIndex < 0) return;

  const batchData = transactionUpdateToCells(updates, rowIndex + 2);
  if (batchData.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: "RAW", data: batchData },
    });
  }
}

import type { Transaction } from "@/types";
import { getSheetsClient, withSheetsRetry } from "./client";
import { ensureTransactionSchema } from "./init";
import {
  COLS,
  transactionToRow,
  rowToTransaction,
  isDeletedRow,
  transactionUpdateToCells,
  DATA_RANGE,
  ID_RANGE,
  LAST_COL,
} from "./transactionSchema";

export const PAGE_SIZE = 200;

// In-memory row-index cache: sheetId → Map<txId, 1-based sheet row number>
// Invalidated whenever a row is appended (row numbers shift for nothing — appends
// add to the end, so existing row numbers remain valid; only invalidate on delete).
const rowIndexCache = new Map<string, Map<string, number>>();

async function getRowIndexMap(
  sheets: ReturnType<typeof getSheetsClient>,
  sheetId: string
): Promise<Map<string, number>> {
  if (rowIndexCache.has(sheetId)) return rowIndexCache.get(sheetId)!;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: ID_RANGE,
  });
  const map = new Map<string, number>();
  (res.data.values ?? []).forEach((r, i) => {
    if (r[0]) map.set(String(r[0]), i + 2); // +2: 1-indexed + header row
  });
  rowIndexCache.set(sheetId, map);
  return map;
}

function invalidateRowIndex(sheetId: string) {
  rowIndexCache.delete(sheetId);
}

export interface TransactionPage {
  transactions: Transaction[];
  total: number;       // total data rows in sheet (excludes header, includes soft-deleted)
  hasMore: boolean;
}

// Count non-deleted rows by reading the ID column and deleted column in one batchGet.
// Returns the number of rows that have an ID and are not soft-deleted.
async function getRowCount(
  sheets: ReturnType<typeof getSheetsClient>,
  sheetId: string
): Promise<number> {
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: ["transactions!A2:A", `transactions!${COLS.deleted.letter}2:${COLS.deleted.letter}`],
    majorDimension: "COLUMNS",
  });
  const [idRange, deletedRange] = res.data.valueRanges ?? [];
  const ids     = idRange?.values?.[0]     ?? [];
  const deleted = deletedRange?.values?.[0] ?? [];
  return ids.filter((id, i) => id && deleted[i] !== "TRUE").length;
}

export async function appendTransaction(
  accessToken: string,
  sheetId: string,
  tx: Transaction
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  await ensureTransactionSchema(sheets, sheetId);
  await withSheetsRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "transactions!A2",
      valueInputOption: "RAW",
      requestBody: { values: [transactionToRow(tx)] },
    })
  );
}

// Fetch one page of transactions, working backwards from the end of the sheet.
// Page 1 = most recently appended rows (highest row numbers).
// Rows are in insert order, not date order — sort happens client-side.
export async function getTransactions(
  accessToken: string,
  sheetId: string,
  page = 1,
  pageSize = PAGE_SIZE
): Promise<TransactionPage> {
  const sheets = getSheetsClient(accessToken);
  const total = await getRowCount(sheets, sheetId);

  if (total === 0) return { transactions: [], total: 0, hasMore: false };

  // +1 because row 1 is the header; data starts at row 2
  const lastDataRow = total + 1;
  const endRow   = lastDataRow - (page - 1) * pageSize;
  const startRow = Math.max(2, endRow - pageSize + 1);
  const hasMore  = startRow > 2;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `transactions!A${startRow}:${LAST_COL}${endRow}`,
  });

  const rows = res.data.values ?? [];
  const transactions = rows
    .filter((r) => r[0])
    .filter((r) => !isDeletedRow(r as string[]))
    .map((r) => rowToTransaction(r as string[]));

  return { transactions, total, hasMore };
}

// Only searches the most recent page — safe for recently-created rows
// (e.g. receipt placeholders). Do not use to look up arbitrary old transactions.
export async function getTransactionById(
  accessToken: string,
  sheetId: string,
  txId: string
): Promise<Transaction | null> {
  const { transactions } = await getTransactions(accessToken, sheetId);
  return transactions.find((t) => t.id === txId) ?? null;
}

export async function updateTransactionField(
  accessToken: string,
  sheetId: string,
  txId: string,
  updates: Partial<Transaction>
): Promise<void> {
  const sheets = getSheetsClient(accessToken);
  const indexMap = await getRowIndexMap(sheets, sheetId);
  const rowNumber = indexMap.get(txId);
  if (!rowNumber) return;

  const batchData = transactionUpdateToCells(updates, rowNumber);
  if (batchData.length > 0) {
    await withSheetsRetry(() =>
      sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { valueInputOption: "RAW", data: batchData },
      })
    );
    // Soft deletes change the logical row set — invalidate so next update re-fetches
    if (updates.deleted) invalidateRowIndex(sheetId);
  }
}

// Fetch every transaction across all pages — for server-side analysis jobs only.
// Not suitable for client-side rendering; use getTransactions() with pagination instead.
export async function getAllTransactions(
  accessToken: string,
  sheetId: string,
  pageSize = PAGE_SIZE
): Promise<Transaction[]> {
  const all: Transaction[] = [];
  let page = 1;
  while (true) {
    const { transactions, hasMore } = await getTransactions(accessToken, sheetId, page, pageSize);
    all.push(...transactions);
    if (!hasMore) break;
    page++;
  }
  return all;
}

// Re-export DATA_RANGE so callers that already import from this file still work
export { DATA_RANGE };

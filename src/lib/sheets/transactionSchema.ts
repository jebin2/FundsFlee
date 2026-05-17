import type { Transaction, TransactionStatus, RecurrencePeriod } from "@/types";

// Single source of truth for the transactions sheet column layout.
// When adding a column: add it here and nowhere else.
export const COLS = {
  id:                { index: 0,  letter: "A" },
  date:              { index: 1,  letter: "B" },
  time:              { index: 2,  letter: "C" },
  amount:            { index: 3,  letter: "D" },
  original_amount:   { index: 4,  letter: "E" },
  original_currency: { index: 5,  letter: "F" },
  merchant:          { index: 6,  letter: "G" },
  category:          { index: 7,  letter: "H" },
  subcategory:       { index: 8,  letter: "I" },
  item_name:         { index: 9,  letter: "J" },
  payment_method:    { index: 10, letter: "K" },
  tags:              { index: 11, letter: "L" },
  notes:             { index: 12, letter: "M" },
  source:            { index: 13, letter: "N" },
  raw_input:         { index: 14, letter: "O" },
  location:          { index: 15, letter: "P" },
  is_duplicate:      { index: 16, letter: "Q" },
  duplicate_ref:     { index: 17, letter: "R" },
  created_at:        { index: 18, letter: "S" },
  updated_at:        { index: 19, letter: "T" },
  status:            { index: 20, letter: "U" },
  receipt_url:       { index: 21, letter: "V" },
  receipt_id:        { index: 22, letter: "W" },
  quantity:          { index: 23, letter: "X" },
  deleted:           { index: 24, letter: "Y" },
  recurrence:        { index: 25, letter: "Z" },
  merge_id:          { index: 26, letter: "AA" },
} as const;

export const LAST_COL = COLS.merge_id.letter;
export const ID_RANGE = "transactions!A2:A5000";
export const DATA_RANGE = (limit: number) => `transactions!A2:${LAST_COL}${limit + 1}`;

export function transactionToRow(tx: Transaction): unknown[] {
  return [
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
    tx.recurrence ?? "",
    tx.merge_id ?? "",
  ];
}

export function rowToTransaction(r: string[]): Transaction {
  const c = COLS;
  // Pad short rows so index access never throws on malformed sheet data
  const row = r.length >= Object.keys(COLS).length ? r : [...r, ...Array(Object.keys(COLS).length).fill("")];
  return {
    id:                row[c.id.index],
    date:              row[c.date.index] ?? "",
    time:              row[c.time.index] ?? "",
    amount:            parseFloat(row[c.amount.index]) || 0,
    original_amount:   row[c.original_amount.index] ? parseFloat(row[c.original_amount.index]) : undefined,
    original_currency: row[c.original_currency.index] || undefined,
    merchant:          row[c.merchant.index] ?? "",
    category:          row[c.category.index] ?? "",
    subcategory:       row[c.subcategory.index] || undefined,
    item_name:         row[c.item_name.index] || undefined,
    payment_method:    (row[c.payment_method.index] as Transaction["payment_method"]) || "Other",
    tags:              row[c.tags.index] ? row[c.tags.index].split(",").filter(Boolean) : undefined,
    notes:             row[c.notes.index] || undefined,
    source:            (row[c.source.index] as Transaction["source"]) || "manual",
    raw_input:         row[c.raw_input.index] || undefined,
    location:          row[c.location.index] || undefined,
    is_duplicate:      row[c.is_duplicate.index] === "TRUE",
    duplicate_ref:     row[c.duplicate_ref.index] || undefined,
    created_at:        row[c.created_at.index] ?? "",
    updated_at:        row[c.updated_at.index] ?? "",
    status:            (row[c.status.index] as TransactionStatus) || "done",
    receipt_url:       row[c.receipt_url.index] || undefined,
    receipt_id:        row[c.receipt_id.index] || undefined,
    quantity:          row[c.quantity.index] || undefined,
    recurrence:        (row[c.recurrence.index] as RecurrencePeriod) || undefined,
    merge_id:          row[c.merge_id.index] || undefined,
  };
}

export function isDeletedRow(r: string[]): boolean {
  return r[COLS.deleted.index] === "TRUE" || r[COLS.notes.index] === "__DELETED__";
}

type UpdatableKey = Exclude<keyof typeof COLS, "id" | "created_at">;

export function transactionUpdateToCells(
  updates: Partial<Transaction>,
  rowNumber: number,
  now = new Date().toISOString()
): { range: string; values: unknown[][] }[] {
  const updatable = Object.keys(COLS).filter(
    (k) => k !== "id" && k !== "created_at"
  ) as UpdatableKey[];

  const result: { range: string; values: unknown[][] }[] = [];

  for (const key of updatable) {
    if (key in updates || key === "updated_at") {
      let val: unknown = key === "updated_at" ? now : updates[key as keyof Transaction];
      if (key === "is_duplicate") val = val ? "TRUE" : "FALSE";
      if (key === "deleted") val = val ? "TRUE" : "";
      if (key === "tags" && Array.isArray(val)) val = (val as string[]).join(",");
      result.push({ range: `transactions!${COLS[key].letter}${rowNumber}`, values: [[val ?? ""]] });
    }
  }

  return result;
}

import type { Transaction, TransactionStatus } from "@/types";

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
} as const;

export const LAST_COL = COLS.deleted.letter;
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
  ];
}

export function rowToTransaction(r: string[]): Transaction {
  const c = COLS;
  return {
    id:                r[c.id.index],
    date:              r[c.date.index] ?? "",
    time:              r[c.time.index] ?? "",
    amount:            parseFloat(r[c.amount.index]) || 0,
    original_amount:   r[c.original_amount.index] ? parseFloat(r[c.original_amount.index]) : undefined,
    original_currency: r[c.original_currency.index] || undefined,
    merchant:          r[c.merchant.index] ?? "",
    category:          r[c.category.index] ?? "",
    subcategory:       r[c.subcategory.index] || undefined,
    item_name:         r[c.item_name.index] || undefined,
    payment_method:    (r[c.payment_method.index] as Transaction["payment_method"]) || "Other",
    tags:              r[c.tags.index] ? r[c.tags.index].split(",").filter(Boolean) : undefined,
    notes:             r[c.notes.index] || undefined,
    source:            (r[c.source.index] as Transaction["source"]) || "manual",
    raw_input:         r[c.raw_input.index] || undefined,
    location:          r[c.location.index] || undefined,
    is_duplicate:      r[c.is_duplicate.index] === "TRUE",
    duplicate_ref:     r[c.duplicate_ref.index] || undefined,
    created_at:        r[c.created_at.index] ?? "",
    updated_at:        r[c.updated_at.index] ?? "",
    status:            (r[c.status.index] as TransactionStatus) || "done",
    receipt_url:       r[c.receipt_url.index] || undefined,
    receipt_id:        r[c.receipt_id.index] || undefined,
    quantity:          r[c.quantity.index] || undefined,
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

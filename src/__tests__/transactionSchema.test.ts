import { describe, it, expect } from "vitest";
import {
  COLS,
  transactionToRow,
  rowToTransaction,
  isDeletedRow,
  transactionUpdateToCells,
} from "@/lib/sheets/transactionSchema";
import type { Transaction } from "@/types";

const BASE_TX: Transaction = {
  id: "tx-001",
  date: "2025-04-26",
  time: "14:30",
  amount: 450,
  merchant: "Swiggy",
  category: "Food & Dining",
  payment_method: "UPI",
  source: "sms",
  created_at: "2025-04-26T14:30:00.000Z",
  updated_at: "2025-04-26T14:30:00.000Z",
  status: "done",
  is_duplicate: false,
};

describe("transactionToRow", () => {
  it("places every field in the correct column index", () => {
    const row = transactionToRow(BASE_TX) as string[];
    expect(row[COLS.id.index]).toBe("tx-001");
    expect(row[COLS.date.index]).toBe("2025-04-26");
    expect(row[COLS.time.index]).toBe("14:30");
    expect(row[COLS.amount.index]).toBe(450);
    expect(row[COLS.merchant.index]).toBe("Swiggy");
    expect(row[COLS.category.index]).toBe("Food & Dining");
    expect(row[COLS.payment_method.index]).toBe("UPI");
    expect(row[COLS.source.index]).toBe("sms");
    expect(row[COLS.is_duplicate.index]).toBe("FALSE");
    expect(row[COLS.status.index]).toBe("done");
    expect(row[COLS.deleted.index]).toBe("");
  });

  it("serialises is_duplicate=true as TRUE", () => {
    const row = transactionToRow({ ...BASE_TX, is_duplicate: true }) as string[];
    expect(row[COLS.is_duplicate.index]).toBe("TRUE");
  });

  it("serialises deleted=true as TRUE, falsy as empty string", () => {
    const deleted = transactionToRow({ ...BASE_TX, deleted: true }) as string[];
    expect(deleted[COLS.deleted.index]).toBe("TRUE");

    const normal = transactionToRow(BASE_TX) as string[];
    expect(normal[COLS.deleted.index]).toBe("");
  });

  it("joins tags array as comma-separated string", () => {
    const row = transactionToRow({ ...BASE_TX, tags: ["food", "upi"] }) as string[];
    expect(row[COLS.tags.index]).toBe("food,upi");
  });

  it("uses empty string for optional missing fields", () => {
    const row = transactionToRow(BASE_TX) as string[];
    expect(row[COLS.item_name.index]).toBe("");
    expect(row[COLS.notes.index]).toBe("");
    expect(row[COLS.original_amount.index]).toBe("");
  });
});

describe("rowToTransaction", () => {
  it("roundtrips a full transaction through row and back", () => {
    const row = transactionToRow(BASE_TX) as string[];
    const result = rowToTransaction(row);
    expect(result.id).toBe(BASE_TX.id);
    expect(result.date).toBe(BASE_TX.date);
    expect(result.amount).toBe(BASE_TX.amount);
    expect(result.merchant).toBe(BASE_TX.merchant);
    expect(result.is_duplicate).toBe(false);
    expect(result.status).toBe("done");
  });

  it("parses is_duplicate TRUE/FALSE correctly", () => {
    const rowTrue = transactionToRow({ ...BASE_TX, is_duplicate: true }) as string[];
    expect(rowToTransaction(rowTrue).is_duplicate).toBe(true);

    const rowFalse = transactionToRow({ ...BASE_TX, is_duplicate: false }) as string[];
    expect(rowToTransaction(rowFalse).is_duplicate).toBe(false);
  });

  it("parses original_amount when present", () => {
    const row = transactionToRow({ ...BASE_TX, original_amount: 5.99, original_currency: "USD" }) as string[];
    const tx = rowToTransaction(row);
    expect(tx.original_amount).toBe(5.99);
    expect(tx.original_currency).toBe("USD");
  });

  it("splits comma-separated tags back into an array", () => {
    const row = transactionToRow({ ...BASE_TX, tags: ["food", "upi"] }) as string[];
    expect(rowToTransaction(row).tags).toEqual(["food", "upi"]);
  });

  it("returns undefined for optional fields when empty", () => {
    const row = transactionToRow(BASE_TX) as string[];
    const tx = rowToTransaction(row);
    expect(tx.item_name).toBeUndefined();
    expect(tx.notes).toBeUndefined();
    expect(tx.original_amount).toBeUndefined();
    expect(tx.tags).toBeUndefined();
  });

  it("defaults payment_method to Other and source to manual when missing", () => {
    const sparse = new Array(25).fill("") as string[];
    sparse[COLS.id.index] = "tx-sparse";
    const tx = rowToTransaction(sparse);
    expect(tx.payment_method).toBe("Other");
    expect(tx.source).toBe("manual");
    expect(tx.status).toBe("done");
  });
});

describe("isDeletedRow", () => {
  it("returns true when deleted column is TRUE", () => {
    const row = transactionToRow({ ...BASE_TX, deleted: true }) as string[];
    expect(isDeletedRow(row)).toBe(true);
  });

  it("returns true for legacy __DELETED__ notes sentinel", () => {
    const row = new Array(25).fill("") as string[];
    row[COLS.notes.index] = "__DELETED__";
    expect(isDeletedRow(row)).toBe(true);
  });

  it("returns false for a normal row", () => {
    const row = transactionToRow(BASE_TX) as string[];
    expect(isDeletedRow(row)).toBe(false);
  });
});

describe("transactionUpdateToCells", () => {
  const FIXED_NOW = "2025-04-26T15:00:00.000Z";

  it("always includes updated_at in the batch", () => {
    const cells = transactionUpdateToCells({ merchant: "Zomato" }, 5, FIXED_NOW);
    const ranges = cells.map((c) => c.range);
    expect(ranges).toContain(`transactions!${COLS.updated_at.letter}5`);
    expect(ranges).toContain(`transactions!${COLS.merchant.letter}5`);
  });

  it("uses the correct row number in the range", () => {
    const cells = transactionUpdateToCells({ category: "Transport" }, 42, FIXED_NOW);
    cells.forEach((c) => expect(c.range).toMatch(/42$/));
  });

  it("serialises is_duplicate update as TRUE/FALSE", () => {
    const cells = transactionUpdateToCells({ is_duplicate: true }, 3, FIXED_NOW);
    const dupCell = cells.find((c) => c.range.includes(COLS.is_duplicate.letter));
    expect(dupCell?.values[0][0]).toBe("TRUE");
  });

  it("serialises deleted=true as TRUE, false as empty string", () => {
    const cellsTrue = transactionUpdateToCells({ deleted: true }, 3, FIXED_NOW);
    const trueCell = cellsTrue.find((c) => c.range.includes(COLS.deleted.letter));
    expect(trueCell?.values[0][0]).toBe("TRUE");

    const cellsFalse = transactionUpdateToCells({ deleted: false }, 3, FIXED_NOW);
    const falseCell = cellsFalse.find((c) => c.range.includes(COLS.deleted.letter));
    expect(falseCell?.values[0][0]).toBe("");
  });

  it("joins tags array before writing", () => {
    const cells = transactionUpdateToCells({ tags: ["a", "b"] }, 3, FIXED_NOW);
    const tagsCell = cells.find((c) => c.range.includes(COLS.tags.letter));
    expect(tagsCell?.values[0][0]).toBe("a,b");
  });

  it("does not include id or created_at columns", () => {
    const cells = transactionUpdateToCells({ merchant: "X" }, 3, FIXED_NOW);
    const ranges = cells.map((c) => c.range);
    expect(ranges.some((r) => r.includes(COLS.id.letter + "3"))).toBe(false);
    expect(ranges.some((r) => r.includes(COLS.created_at.letter + "3"))).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  filterAndSortTransactions,
  groupTransactionsByDate,
  getDuplicateGroups,
  formatTransactionDateLabel,
  type TransactionListFilters,
} from "@/features/transactions/utils/list";
import type { Transaction } from "@/types";

function makeTx(overrides: Partial<Transaction> & { id: string }): Transaction {
  return {
    date: "2025-04-26",
    time: "10:00",
    amount: 100,
    merchant: "Test",
    category: "Food & Dining",
    payment_method: "UPI",
    source: "manual",
    created_at: "2025-04-26T10:00:00.000Z",
    updated_at: "2025-04-26T10:00:00.000Z",
    status: "done",
    is_duplicate: false,
    ...overrides,
  };
}

const BASE_FILTERS: TransactionListFilters = {
  search: "",
  category: "",
  showDuplicatesOnly: false,
  datePreset: "",
  customFrom: "",
  customTo: "",
};

describe("filterAndSortTransactions", () => {
  it("returns all transactions when filters are empty", () => {
    const txs = [makeTx({ id: "a" }), makeTx({ id: "b" })];
    expect(filterAndSortTransactions(txs, BASE_FILTERS)).toHaveLength(2);
  });

  it("filters by search — merchant match", () => {
    const txs = [makeTx({ id: "a", merchant: "Swiggy" }), makeTx({ id: "b", merchant: "Zomato" })];
    const result = filterAndSortTransactions(txs, { ...BASE_FILTERS, search: "swig" });
    expect(result).toHaveLength(1);
    expect(result[0].merchant).toBe("Swiggy");
  });

  it("filters by search — item_name match", () => {
    const txs = [makeTx({ id: "a", item_name: "Biryani" }), makeTx({ id: "b", item_name: "Pizza" })];
    const result = filterAndSortTransactions(txs, { ...BASE_FILTERS, search: "biryani" });
    expect(result[0].item_name).toBe("Biryani");
  });

  it("filters by search — category and notes match", () => {
    const txs = [
      makeTx({ id: "a", category: "Transport", notes: undefined }),
      makeTx({ id: "b", notes: "work trip" }),
    ];
    const byCategory = filterAndSortTransactions(txs, { ...BASE_FILTERS, search: "transport" });
    expect(byCategory).toHaveLength(1);

    const byNotes = filterAndSortTransactions(txs, { ...BASE_FILTERS, search: "work" });
    expect(byNotes).toHaveLength(1);
  });

  it("filters by category", () => {
    const txs = [
      makeTx({ id: "a", category: "Food & Dining" }),
      makeTx({ id: "b", category: "Transport" }),
    ];
    const result = filterAndSortTransactions(txs, { ...BASE_FILTERS, category: "Transport" });
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("Transport");
  });

  it("shows only duplicates when showDuplicatesOnly is true", () => {
    const txs = [
      makeTx({ id: "a", is_duplicate: true }),
      makeTx({ id: "b", is_duplicate: false }),
    ];
    const result = filterAndSortTransactions(txs, { ...BASE_FILTERS, showDuplicatesOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("filters by month date preset", () => {
    const now = new Date("2025-04-26T12:00:00Z");
    const txs = [
      makeTx({ id: "this-month", date: "2025-04-10" }),
      makeTx({ id: "last-month", date: "2025-03-15" }),
    ];
    const result = filterAndSortTransactions(txs, { ...BASE_FILTERS, datePreset: "month" }, now);
    expect(result.map((t) => t.id)).toContain("this-month");
    expect(result.map((t) => t.id)).not.toContain("last-month");
  });

  it("filters by custom date range", () => {
    const txs = [
      makeTx({ id: "in-range", date: "2025-04-15" }),
      makeTx({ id: "out-of-range", date: "2025-04-01" }),
    ];
    const result = filterAndSortTransactions(txs, {
      ...BASE_FILTERS,
      datePreset: "custom",
      customFrom: "2025-04-10",
      customTo: "2025-04-20",
    });
    expect(result.map((t) => t.id)).toContain("in-range");
    expect(result.map((t) => t.id)).not.toContain("out-of-range");
  });

  it("sorts newest date first", () => {
    const txs = [
      makeTx({ id: "old", date: "2025-04-01" }),
      makeTx({ id: "new", date: "2025-04-26" }),
    ];
    const result = filterAndSortTransactions(txs, BASE_FILTERS);
    expect(result[0].id).toBe("new");
  });

  it("floats in-flight entries (queued/processing) to the top", () => {
    const txs = [
      makeTx({ id: "done", date: "2025-04-26", status: "done" }),
      makeTx({ id: "queued", date: "2025-04-24", status: "queued" }),
    ];
    const result = filterAndSortTransactions(txs, BASE_FILTERS);
    expect(result[0].id).toBe("queued");
  });
});

describe("groupTransactionsByDate", () => {
  it("groups transactions by date key", () => {
    const txs = [
      makeTx({ id: "a", date: "2025-04-26" }),
      makeTx({ id: "b", date: "2025-04-26" }),
      makeTx({ id: "c", date: "2025-04-25" }),
    ];
    const groups = groupTransactionsByDate(txs);
    expect(Object.keys(groups)).toHaveLength(2);
    expect(groups["2025-04-26"]).toHaveLength(2);
    expect(groups["2025-04-25"]).toHaveLength(1);
  });

  it("returns empty object for empty input", () => {
    expect(groupTransactionsByDate([])).toEqual({});
  });
});

describe("getDuplicateGroups", () => {
  it("groups duplicates under their original", () => {
    const txs = [
      makeTx({ id: "orig" }),
      makeTx({ id: "dup1", is_duplicate: true, duplicate_ref: "orig" }),
      makeTx({ id: "dup2", is_duplicate: true, duplicate_ref: "orig" }),
    ];
    const groups = getDuplicateGroups(txs);
    expect(groups).toHaveLength(1);
    expect(groups[0].original.id).toBe("orig");
    expect(groups[0].duplicates).toHaveLength(2);
  });

  it("ignores duplicates whose original does not exist", () => {
    const txs = [makeTx({ id: "dup", is_duplicate: true, duplicate_ref: "missing" })];
    expect(getDuplicateGroups(txs)).toHaveLength(0);
  });

  it("returns empty array when there are no duplicates", () => {
    const txs = [makeTx({ id: "a" }), makeTx({ id: "b" })];
    expect(getDuplicateGroups(txs)).toHaveLength(0);
  });
});

describe("formatTransactionDateLabel", () => {
  const now = new Date("2025-04-26T12:00:00Z");

  it("returns Today for the current date", () => {
    expect(formatTransactionDateLabel("2025-04-26", now)).toBe("Today");
  });

  it("returns Yesterday for the previous date", () => {
    expect(formatTransactionDateLabel("2025-04-25", now)).toBe("Yesterday");
  });

  it("returns a formatted date string for older dates", () => {
    const label = formatTransactionDateLabel("2025-04-01", now);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
    expect(label.length).toBeGreaterThan(0);
  });
});

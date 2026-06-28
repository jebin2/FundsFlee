// TS side of the Phase-2 parity harness.
// Writes parity/ts-output.json from shared fixtures; if parity/py-output.json
// exists (produced by backend/scripts/parity_serialization.py), asserts both
// sides are deep-equal.
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  transactionToRow,
  rowToTransaction,
  isDeletedRow,
  transactionUpdateToCells,
} from "@/lib/sheets/transactionSchema";
import type { Transaction } from "@/types";

const DIR = join(__dirname);
const fixtures = JSON.parse(readFileSync(join(DIR, "fixtures.json"), "utf-8")) as {
  transactions: Transaction[];
  raw_rows: { name: string; row: string[] }[];
};

const FIXED_NOW = "2026-06-13T12:00:00.000Z";

function buildOutput() {
  return {
    to_row: fixtures.transactions.map((tx) => transactionToRow(tx)),
    roundtrip: fixtures.transactions.map((tx) =>
      rowToTransaction(transactionToRow(tx) as string[])
    ),
    from_raw: fixtures.raw_rows.map((f) => ({
      name: f.name,
      transaction: rowToTransaction(f.row),
      is_deleted: isDeletedRow(f.row),
    })),
    update_cells: [
      transactionUpdateToCells({ merchant: "Zomato", amount: 12.5 }, 7, FIXED_NOW),
      transactionUpdateToCells({ deleted: true }, 42, FIXED_NOW),
      transactionUpdateToCells({ is_duplicate: false, tags: ["x", "y"], notes: undefined as unknown as string }, 3, FIXED_NOW),
    ],
  };
}

describe("serialization parity (TS side)", () => {
  it("writes ts-output.json and matches py-output.json when present", () => {
    const output = buildOutput();
    writeFileSync(join(DIR, "ts-output.json"), JSON.stringify(output, null, 2));

    const pyPath = join(DIR, "py-output.json");
    if (!existsSync(pyPath)) {
      console.warn("parity: py-output.json not found — run backend/scripts/parity_serialization.py and re-run");
      return;
    }
    const py = JSON.parse(readFileSync(pyPath, "utf-8"));
    expect(py).toEqual(JSON.parse(JSON.stringify(output)));
  });
});

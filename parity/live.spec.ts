// Live read-parity check — TS side. Reads the real sheet through the OLD
// Next.js data layer and writes parity/ts-live.json.
//
// Gated on env (get them from the backend):
//   cd backend && eval $(python scripts/parity_live.py --print-token)
//   npx vitest run parity/live.spec.ts
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAllTransactions } from "@/lib/sheets/transactions";
import { getCategories } from "@/lib/sheets/categories";
import { getMetaValues } from "@/lib/sheets/meta";

const token = process.env.PARITY_ACCESS_TOKEN;
const sheetId = process.env.PARITY_SHEET_ID;

describe.skipIf(!token || !sheetId)("live read parity (TS side)", () => {
  it("dumps transactions/categories/meta to ts-live.json", async () => {
    const output = {
      transactions: await getAllTransactions(token!, sheetId!),
      categories: await getCategories(token!, sheetId!),
      meta_keys: Object.keys(await getMetaValues(token!, sheetId!)).sort(),
    };
    writeFileSync(join(__dirname, "ts-live.json"), JSON.stringify(output, null, 2));
    console.log(`wrote parity/ts-live.json (${output.transactions.length} transactions)`);
  }, 120_000);
});

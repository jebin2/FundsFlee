import { generateText } from "./client";
import type { Transaction } from "@/types";

export interface DuplicateGroup {
  original_id: string;
  duplicate_ids: string[];
  reason: string;
}

export async function findDuplicates(transactions: Transaction[]): Promise<DuplicateGroup[]> {
  // Group by date — only dates with 2+ transactions can have duplicates
  const byDate: Record<string, Transaction[]> = {};
  for (const tx of transactions) {
    (byDate[tx.date] ??= []).push(tx);
  }

  const results: DuplicateGroup[] = [];

  for (const [date, txs] of Object.entries(byDate)) {
    if (txs.length < 2) continue;

    const raw = await generateText(
      `Find duplicate transactions within this single day: ${date}

Transactions:
${JSON.stringify(txs.map((t) => ({ id: t.id, item_name: t.item_name ?? "", merchant: t.merchant, amount: t.amount, time: t.time })))}

A duplicate means: same item_name (or very similar) AND same amount on the same day.
Rules:
- "Unknown" merchant alone is NOT enough — require matching item_name
- Different item names = NOT a duplicate even if amount matches
- Pick the EARLIEST time entry as original_id; rest go in duplicate_ids
- Return empty array [] if no duplicates found

Respond with JSON only:
[
  {
    "original_id": "id of earliest entry to keep",
    "duplicate_ids": ["id2", "id3"],
    "reason": "brief reason"
  }
]`,
      "",
      512
    );

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) continue;
    try {
      const groups: DuplicateGroup[] = JSON.parse(match[0]);
      results.push(...groups.filter((g) => g.duplicate_ids?.length > 0));
    } catch {
      // skip unparseable response
    }
  }

  return results;
}

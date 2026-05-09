import { generateText } from "./client";
import type { Transaction, DuplicateResult } from "@/types";

export async function checkDuplicate(
  newTransaction: Transaction,
  recentTransactions: Transaction[]
): Promise<DuplicateResult> {
  if (recentTransactions.length === 0) {
    return { is_duplicate: false, confidence: 0 };
  }

  const candidates = recentTransactions
    .filter((t) => t.id !== newTransaction.id)
    .filter((t) => {
      const daysDiff = Math.abs(
        new Date(newTransaction.date).getTime() - new Date(t.date).getTime()
      ) / (1000 * 60 * 60 * 24);
      return daysDiff <= 1;
    })
    .slice(0, 20);

  if (candidates.length === 0) {
    return { is_duplicate: false, confidence: 0 };
  }

  const raw = await generateText(
    `Check if this new transaction is a duplicate of any of the recent ones.

New transaction:
${JSON.stringify({ merchant: newTransaction.merchant, amount: newTransaction.amount, date: newTransaction.date, time: newTransaction.time })}

Recent transactions (last 24h):
${JSON.stringify(candidates.map((t) => ({ id: t.id, merchant: t.merchant, amount: t.amount, date: t.date, time: t.time })))}

Duplicate criteria:
- HIGH confidence (>0.85): Same merchant + same amount + within 2 hours
- MEDIUM confidence (0.6-0.85): Same merchant + amount within 5% + same day
- LOW confidence (<0.6): Same amount + same day, different merchant

Respond with JSON only:
{
  "is_duplicate": boolean,
  "confidence": number 0-1,
  "duplicate_of_id": string or null,
  "reason": string
}`,
    "",
    512
  );

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { is_duplicate: false, confidence: 0 };
  return JSON.parse(jsonMatch[0]) as DuplicateResult;
}

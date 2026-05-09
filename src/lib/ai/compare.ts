import { generateText } from "./client";
import type { Transaction } from "@/types";

export interface MerchantStats {
  merchant: string;
  visits: number;
  totalSpent: number;
  avgPerVisit: number;
  minSpend: number;
  maxSpend: number;
  categories: string[];
  topItems: { name: string; count: number; avgPrice: number }[];
}

export interface CompareAspect {
  aspect: string;
  analysis: string;
  winner: string | null;
  scores: Record<string, number>;
}

export interface CompareResult {
  merchants: string[];
  period: string;
  summary: string;
  verdict: string;
  aspects: CompareAspect[];
  recommendation: string;
}

function buildStats(merchant: string, txs: Transaction[]): MerchantStats {
  const relevant = txs.filter((t) => t.merchant === merchant && t.amount > 0);

  // Count distinct item_names bought from this merchant
  const itemMap: Record<string, { count: number; total: number }> = {};
  for (const tx of relevant) {
    if (!tx.item_name) continue;
    if (!itemMap[tx.item_name]) itemMap[tx.item_name] = { count: 0, total: 0 };
    itemMap[tx.item_name].count += 1;
    itemMap[tx.item_name].total += tx.amount;
  }

  const topItems = Object.entries(itemMap)
    .map(([name, d]) => ({ name, count: d.count, avgPrice: Math.round(d.total / d.count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const amounts = relevant.map((t) => t.amount);
  return {
    merchant,
    visits: relevant.length,
    totalSpent: amounts.reduce((s, a) => s + a, 0),
    avgPerVisit: amounts.length ? Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length) : 0,
    minSpend: amounts.length ? Math.min(...amounts) : 0,
    maxSpend: amounts.length ? Math.max(...amounts) : 0,
    categories: [...new Set(relevant.map((t) => t.category))],
    topItems,
  };
}

export async function compareMerchants(
  merchants: string[],
  transactions: Transaction[],
  period: string,
  region: string
): Promise<CompareResult> {
  const stats = merchants.map((m) => buildStats(m, transactions));

  const statsText = stats
    .map((s) =>
      `**${s.merchant}**
- Visits: ${s.visits}
- Total spent: ₹${s.totalSpent.toLocaleString("en-IN")}
- Avg per visit: ₹${s.avgPerVisit}
- Range: ₹${s.minSpend}–₹${s.maxSpend}
- Categories: ${s.categories.join(", ")}
${s.topItems.length ? `- Top items: ${s.topItems.map((i) => `${i.name} (${i.count}×, avg ₹${i.avgPrice})`).join(", ")}` : ""}`
    )
    .join("\n\n");

  const raw = await generateText(
    `Compare these merchants for a user in ${region || "India"} over the period: ${period}.

${statsText}

Analyse and compare them on price, quantity/value, loyalty signals (repeat visits), and overall worth. Be specific and direct.

Respond with JSON only:
{
  "summary": "2-3 sentence overview",
  "verdict": "name of the best overall merchant",
  "aspects": [
    {
      "aspect": "Price",
      "analysis": "specific observation",
      "winner": "merchant name or null if tied",
      "scores": { "${merchants[0]}": 0-10, "${merchants[1]}": 0-10 }
    },
    {
      "aspect": "Value for money",
      "analysis": "...",
      "winner": "...",
      "scores": { ... }
    },
    {
      "aspect": "Visit frequency",
      "analysis": "...",
      "winner": "...",
      "scores": { ... }
    },
    {
      "aspect": "Spend consistency",
      "analysis": "...",
      "winner": "...",
      "scores": { ... }
    }
  ],
  "recommendation": "1-2 sentence actionable advice"
}`,
    "",
    2048
  );

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in AI response");
  const parsed = JSON.parse(jsonMatch[0]);

  return {
    merchants,
    period,
    summary: parsed.summary,
    verdict: parsed.verdict,
    aspects: parsed.aspects,
    recommendation: parsed.recommendation,
  };
}

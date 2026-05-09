import { generateText } from "./client";
import type { Transaction, AnalysisResult } from "@/types";

export async function analyzeSpending(
  transactions: Transaction[],
  periodLabel: string,
  userRegion: string,
  lifestyleTags: string[]
): Promise<AnalysisResult> {
  const totalSpent = transactions.reduce((sum, t) => sum + t.amount, 0);

  const byCategory: Record<string, number> = {};
  for (const t of transactions) {
    byCategory[t.category] = (byCategory[t.category] ?? 0) + t.amount;
  }

  const categorySummary = Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a)
    .map(([category, amount]) => ({
      category,
      amount,
      percent: Math.round((amount / totalSpent) * 100),
      count: transactions.filter((t) => t.category === category).length,
    }));

  const topMerchants = Object.entries(
    transactions.reduce((acc, t) => {
      acc[t.merchant] = (acc[t.merchant] ?? 0) + t.amount;
      return acc;
    }, {} as Record<string, number>)
  )
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([m, a]) => `- ${m}: ₹${a.toLocaleString("en-IN")}`)
    .join("\n");

  const raw = await generateText(
    `Analyze spending for a user in ${userRegion || "India"}.
Lifestyle: ${lifestyleTags.join(", ") || "not specified"}.
Period: ${periodLabel}.
Total spent: ₹${totalSpent.toLocaleString("en-IN")}.

Spending by category:
${categorySummary.map((c) => `- ${c.category}: ₹${c.amount.toLocaleString("en-IN")} (${c.percent}%, ${c.count} transactions)`).join("\n")}

Top merchants:
${topMerchants}

Provide analysis as JSON:
{
  "ai_insights": [3-5 specific observations about their spending patterns],
  "optimization_tips": [
    {
      "title": string,
      "description": string (specific to their region and lifestyle),
      "potential_saving": number (in INR per month),
      "effort": "low"|"medium"|"high",
      "quality_impact": "none"|"minimal"|"moderate"
    }
  ]
}

Be specific to the region (suggest local alternatives, local prices). For Indian users mention specific apps, services, and local options.`,
    "",
    2048
  );

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const aiData = jsonMatch ? JSON.parse(jsonMatch[0]) : { ai_insights: [], optimization_tips: [] };

  return {
    period: periodLabel,
    period_type: "month",
    total_spent: totalSpent,
    by_category: categorySummary,
    ai_insights: aiData.ai_insights ?? [],
    optimization_tips: aiData.optimization_tips ?? [],
  };
}

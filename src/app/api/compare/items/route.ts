import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTransactions, getAnalysisCache, upsertAnalysisCacheRow } from "@/lib/sheets";
import { normalizeItemNames } from "@/lib/ai/normalize-items";

export interface ItemPriceEntry {
  merchant: string;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  count: number;
  lastDate: string;
  notes?: string;
}

export interface ItemPriceComparison {
  canonical: string;
  entries: ItemPriceEntry[];  // sorted cheapest first
}

// Fingerprint = sorted unique names joined — cache key changes when new items appear
function fingerprint(names: string[]): string {
  return [...names].sort().join("|");
}

function buildComparisons(
  transactions: { merchant: string; amount: number; item_name?: string; date: string; notes?: string; notes_deleted?: boolean }[],
  groups: { canonical: string; variants: string[] }[]
): ItemPriceComparison[] {
  // variant (lowercase) → canonical
  const canonMap: Record<string, string> = {};
  for (const g of groups) {
    for (const v of g.variants) canonMap[v.toLowerCase().trim()] = g.canonical;
  }

  // canonical → merchant → prices
  const data: Record<string, Record<string, { prices: number[]; lastDate: string; notes?: string }>> = {};

  for (const tx of transactions) {
    if (!tx.item_name) continue;
    const canon = canonMap[tx.item_name.toLowerCase().trim()] ?? tx.item_name;
    if (!data[canon]) data[canon] = {};
    if (!data[canon][tx.merchant]) data[canon][tx.merchant] = { prices: [], lastDate: tx.date };
    data[canon][tx.merchant].prices.push(tx.amount);
    if (tx.date > data[canon][tx.merchant].lastDate) data[canon][tx.merchant].lastDate = tx.date;
    if (tx.notes) data[canon][tx.merchant].notes = tx.notes;
  }

  return Object.entries(data)
    .filter(([, merchants]) => Object.keys(merchants).length >= 2)
    .map(([canonical, merchants]) => ({
      canonical,
      entries: Object.entries(merchants)
        .map(([merchant, d]) => ({
          merchant,
          avgPrice: Math.round(d.prices.reduce((s, p) => s + p, 0) / d.prices.length),
          minPrice: Math.min(...d.prices),
          maxPrice: Math.max(...d.prices),
          count: d.prices.length,
          lastDate: d.lastDate,
          notes: d.notes,
        }))
        .sort((a, b) => a.avgPrice - b.avgPrice),
    }))
    .sort((a, b) => b.entries.length - a.entries.length);
}

export async function GET() {
  const session = await auth();
  if (!session?.access_token || !session.sheet_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allTx = await getTransactions(session.access_token, session.sheet_id);
  const withItems = allTx.filter(
    (t) => t.item_name && t.amount > 0
  );

  if (withItems.length === 0) {
    return NextResponse.json({ comparisons: [], total_items: 0 });
  }

  const uniqueNames = [...new Set(withItems.map((t) => t.item_name!))];
  const fp = fingerprint(uniqueNames);
  const cacheKey = `item_norm_${fp.slice(0, 60)}`; // truncate for sheet cell

  // Check cache — no TTL (same fingerprint = same data)
  const cached = await getAnalysisCache(
    session.access_token,
    session.sheet_id,
    cacheKey,
    Infinity
  );

  let groups: { canonical: string; variants: string[] }[];

  if (cached?.status === "done" && cached.summary_json) {
    groups = JSON.parse(cached.summary_json);
  } else {
    // Run AI normalisation
    groups = await normalizeItemNames(uniqueNames);

    // Cache it
    await upsertAnalysisCacheRow(
      session.access_token,
      session.sheet_id,
      cacheKey,
      "item_norm",
      "done",
      JSON.stringify(groups)
    );
  }

  const comparisons = buildComparisons(withItems, groups);
  return NextResponse.json({ comparisons, total_items: uniqueNames.length });
}

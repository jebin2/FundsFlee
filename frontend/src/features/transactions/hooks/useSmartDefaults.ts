"use client";

import { useMemo, useCallback } from "react";
import { useTransactionsStore } from "@/store/transactionsStore";

export function useSmartDefaults() {
  const transactions = useTransactionsStore((s) => s.transactions);

  // Top 6 most recently used distinct merchants, excluding placeholders
  const recentMerchants = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const tx of transactions) {
      const m = tx.merchant;
      if (!m || m === "Unknown" || m === "Processing…") continue;
      if (!seen.has(m)) {
        seen.add(m);
        result.push(m);
        if (result.length >= 6) break;
      }
    }
    return result;
  }, [transactions]);

  // Most common category used with a given merchant
  const getCategoryForMerchant = useCallback(
    (merchant: string): string | null => {
      const lower = merchant.toLowerCase();
      const freq: Record<string, number> = {};
      for (const tx of transactions) {
        if (tx.merchant.toLowerCase() === lower && tx.category) {
          freq[tx.category] = (freq[tx.category] ?? 0) + 1;
        }
      }
      const entries = Object.entries(freq);
      if (entries.length === 0) return null;
      return entries.sort((a, b) => b[1] - a[1])[0][0];
    },
    [transactions]
  );

  return { recentMerchants, getCategoryForMerchant };
}

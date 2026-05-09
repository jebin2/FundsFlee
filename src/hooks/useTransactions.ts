"use client";

import { useAppStore } from "@/store";
import { pullTransactions } from "@/lib/offline";

export function useTransactions() {
  const { transactions, setTransactions } = useAppStore();

  async function refresh() {
    try {
      const txs = await pullTransactions();
      setTransactions(txs);
      return txs;
    } catch {
      return transactions; // offline — return cached
    }
  }

  return { transactions, refresh };
}

"use client";

import { useCallback } from "react";
import { useAppStore } from "@/store";
import { pullTransactions } from "@/lib/offline";

export function useTransactions() {
  const transactions = useAppStore((s) => s.transactions);
  const setTransactions = useAppStore((s) => s.setTransactions);

  // Stable reference — reads latest store state via setter, not closure
  const refresh = useCallback(async () => {
    try {
      const txs = await pullTransactions();
      setTransactions(txs);
      return txs;
    } catch {
      // Offline — return current store snapshot (never stale via selector)
      return useAppStore.getState().transactions;
    }
  }, [setTransactions]);

  return { transactions, refresh };
}

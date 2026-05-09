"use client";

import { useCallback } from "react";
import { useAppStore } from "@/store";
import { pullTransactions } from "@/lib/offline";

export function useTransactions() {
  const transactions = useAppStore((s) => s.transactions);
  const setTransactions = useAppStore((s) => s.setTransactions);

  // Global flag in Zustand — shared across ALL hook instances and components.
  // Prevents concurrent pullTransactions() races from dashboard + transactions page.
  const syncing = useAppStore((s) => s.syncing);
  const setSyncing = useAppStore((s) => s.setSyncing);

  const refresh = useCallback(async () => {
    if (useAppStore.getState().syncing) {
      return useAppStore.getState().transactions;
    }
    setSyncing(true);
    try {
      const txs = await pullTransactions();
      setTransactions(txs);
      return txs;
    } catch {
      return useAppStore.getState().transactions;
    } finally {
      setSyncing(false);
    }
  }, [setTransactions, setSyncing]);

  return { transactions, refresh, syncing };
}

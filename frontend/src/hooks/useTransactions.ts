"use client";

import { useCallback } from "react";
import { useTransactionsStore } from "@/store/transactionsStore";
import { pullTransactions } from "@/lib/offline";

export function useTransactions() {
  const transactions  = useTransactionsStore((s) => s.transactions);
  const total         = useTransactionsStore((s) => s.total);
  const syncing       = useTransactionsStore((s) => s.syncing);
  const { setTransactions, setSyncing } = useTransactionsStore();

  // Full refresh — replaces the store with the whole history
  const refresh = useCallback(async () => {
    if (useTransactionsStore.getState().syncing) {
      return useTransactionsStore.getState().transactions;
    }
    setSyncing(true);
    try {
      const { transactions: txs, total: t } = await pullTransactions();
      setTransactions(txs, t);
      return txs;
    } catch {
      // "aborted" = a newer refresh() cancelled this one; any other error — return stale data
      return useTransactionsStore.getState().transactions;
    } finally {
      setSyncing(false);
    }
  }, [setTransactions, setSyncing]);

  return { transactions, total, syncing, refresh };
}

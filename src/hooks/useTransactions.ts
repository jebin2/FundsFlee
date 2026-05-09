"use client";

import { useCallback, useRef } from "react";
import { useAppStore } from "@/store";
import { pullTransactions } from "@/lib/offline";

export function useTransactions() {
  const transactions = useAppStore((s) => s.transactions);
  const setTransactions = useAppStore((s) => s.setTransactions);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return useAppStore.getState().transactions;
    refreshing.current = true;
    try {
      const txs = await pullTransactions();
      setTransactions(txs);
      return txs;
    } catch {
      return useAppStore.getState().transactions;
    } finally {
      refreshing.current = false;
    }
  }, [setTransactions]);

  return { transactions, refresh };
}

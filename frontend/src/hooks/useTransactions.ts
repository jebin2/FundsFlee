"use client";

import { useCallback, useRef } from "react";
import { useTransactionsStore } from "@/store/transactionsStore";
import { pullTransactions } from "@/lib/offline";

export function useTransactions() {
  const transactions  = useTransactionsStore((s) => s.transactions);
  const total         = useTransactionsStore((s) => s.total);
  const hasMore       = useTransactionsStore((s) => s.hasMore);
  const syncing       = useTransactionsStore((s) => s.syncing);
  const loadingMore   = useTransactionsStore((s) => s.loadingMore);
  const { setTransactions, mergeTransactions, setSyncing, setLoadingMore } = useTransactionsStore();

  const currentPageRef = useRef(1);

  // Full refresh — replaces store with page 1
  const refresh = useCallback(async () => {
    if (useTransactionsStore.getState().syncing) {
      return useTransactionsStore.getState().transactions;
    }
    setSyncing(true);
    try {
      const { transactions: txs, total: t, hasMore: hm } = await pullTransactions(1);
      setTransactions(txs, t, hm);
      currentPageRef.current = 1;
      return txs;
    } catch {
      // "aborted" = a newer refresh() cancelled this one; any other error — return stale data
      return useTransactionsStore.getState().transactions;
    } finally {
      setSyncing(false);
    }
  }, [setTransactions, setSyncing]);

  // Load the next page and merge into the store
  const loadMore = useCallback(async () => {
    // Read both flags from store state to avoid stale closure race
    const state = useTransactionsStore.getState();
    if (state.loadingMore || !state.hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = currentPageRef.current + 1;
      const { transactions: txs, total: t, hasMore: hm } = await pullTransactions(nextPage);
      mergeTransactions(txs, t, hm);
      currentPageRef.current = nextPage;
    } catch {
      // silently ignore — user can retry
    } finally {
      setLoadingMore(false);
    }
  }, [mergeTransactions, setLoadingMore]);

  return { transactions, total, hasMore, syncing, loadingMore, refresh, loadMore };
}

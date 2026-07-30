"use client";

import { useCallback, useRef } from "react";
import { useTransactionsStore } from "@/store/transactionsStore";
import { pullTransactions } from "@/lib/offline";

// The server caps pageSize at 500.
const ALL_PAGE_SIZE = 500;

// 25k transactions. Past this the dashboard needs a server-side aggregate,
// not a bigger client-side loop.
const MAX_ALL_PAGES = 50;

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

  // Pull every remaining page. The dashboard's "All time" needs the whole
  // history: refresh() loads page 1 only, so summing the store would have
  // reported the most recent 200 rows under an "All time" label.
  //
  // Bigger pages than the default 200 (the server caps pageSize at 500) so a
  // long history costs a handful of requests rather than dozens of them.
  const loadAll = useCallback(async () => {
    const state = useTransactionsStore.getState();
    if (state.loadingMore || !state.hasMore) return;
    setLoadingMore(true);
    try {
      let page = 1;
      // Bounded rather than while(hasMore): rows are appended by the email
      // import while this runs, so a server that kept reporting hasMore would
      // otherwise spin here indefinitely.
      for (; page <= MAX_ALL_PAGES; page += 1) {
        const { transactions: txs, total: t, hasMore: hm } =
          await pullTransactions(page, ALL_PAGE_SIZE);
        mergeTransactions(txs, t, hm);
        if (!hm) break;
      }
      // Page numbering above is in ALL_PAGE_SIZE units, not loadMore's. That
      // only stays consistent because the loop exits with hasMore false, which
      // makes loadMore a no-op until the next refresh() resets the cursor.
      currentPageRef.current = page;
    } catch {
      // Keep whatever pages did arrive; the total stays marked incomplete.
    } finally {
      setLoadingMore(false);
    }
  }, [mergeTransactions, setLoadingMore]);

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

  return { transactions, total, hasMore, syncing, loadingMore, refresh, loadMore, loadAll };
}

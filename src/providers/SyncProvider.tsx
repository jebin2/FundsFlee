"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store";
import {
  getLocalTransactions,
  pullTransactions,
  flushQueue,
  pendingCount,
} from "@/lib/offline";

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { setTransactions, setOnline, setPendingCount, setSyncing } = useAppStore();

  async function sync() {
    if (useAppStore.getState().syncing) return;
    setSyncing(true);
    try {
      const txs = await pullTransactions();
      setTransactions(txs);
    } catch (err) {
      if (err instanceof Error && err.message === "auth_expired") {
        return;
      }
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    // Sequential init: local first (instant) → then API (fresh)
    (async () => {
      try {
        const localTxs = await getLocalTransactions();
        if (localTxs.length > 0) setTransactions(localTxs);

        // Restore pending count from last session
        const count = await pendingCount();
        if (count > 0) setPendingCount(count);
      } catch (err) {
        console.error("SyncProvider: failed to load local data:", err);
        // IndexedDB unavailable — continue with empty state, sync will populate
      }

      setOnline(navigator.onLine);
      await sync();
    })();

    const handleOffline = () => setOnline(false);

    const handleOnline = async () => {
      setOnline(true);

      // Loop until queue is fully drained — new mutations may arrive during flush
      // (e.g. user edits a tx while a POST is still flushing, safeFetch queues it).
      // Break if no progress to prevent infinite loop on persistent errors.
      let lastCount = -1;
      while (true) {
        const result = await flushQueue();
        if (result.authExpired) {
          setPendingCount(0);
          return;
        }
        const count = await pendingCount();
        setPendingCount(count);
        if (count === 0 || count === lastCount) break; // drained or no progress
        lastCount = count;
      }

      await sync();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}

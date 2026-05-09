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
    // Use global Zustand flag — shared with useTransactions hook instances
    if (useAppStore.getState().syncing) return;
    setSyncing(true);
    try {
      const txs = await pullTransactions();
      setTransactions(txs);
    } catch (err) {
      if (err instanceof Error && err.message === "auth_expired") {
        // Layout's fetch interceptor will handle sign-out on next API call
        return;
      }
      // Network unavailable — stay on local data
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    // Sequential init: local first (instant) → then API (fresh)
    (async () => {
      const localTxs = await getLocalTransactions();
      if (localTxs.length > 0) setTransactions(localTxs);

      // Restore pending count from last session
      const count = await pendingCount();
      if (count > 0) setPendingCount(count);

      setOnline(navigator.onLine);
      await sync();
    })();

    const handleOffline = () => setOnline(false);

    const handleOnline = async () => {
      setOnline(true);
      const result = await flushQueue();
      if (result.authExpired) return;
      const count = await pendingCount();
      setPendingCount(count);
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

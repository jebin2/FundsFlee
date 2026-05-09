"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/store";
import {
  getLocalTransactions,
  pullTransactions,
  flushQueue,
  pendingCount,
} from "@/lib/offline";

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { setTransactions, setOnline, setPendingCount } = useAppStore();
  const syncing = useRef(false);

  async function sync() {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const txs = await pullTransactions();
      setTransactions(txs);
    } catch {
      // network unavailable — stay on local data
    } finally {
      syncing.current = false;
    }
  }

  useEffect(() => {
    // 1. Load local data immediately (instant render while API fetches)
    getLocalTransactions().then((txs) => {
      if (txs.length > 0) setTransactions(txs);
    });

    // 2. Pull fresh data from API
    sync();

    // 3. Set initial online state
    setOnline(navigator.onLine);

    // Define handlers inside effect so cleanup references the same instances
    const handleOffline = () => setOnline(false);

    const handleOnline = async () => {
      setOnline(true);
      const result = await flushQueue();
      if (result.authExpired) return; // layout interceptor handles sign-out
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

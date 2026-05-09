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

  async function handleOnline() {
    setOnline(true);
    await flushQueue();
    const count = await pendingCount();
    setPendingCount(count);
    await sync();
  }

  useEffect(() => {
    // 1. Load local data immediately (instant render)
    getLocalTransactions().then((txs) => {
      if (txs.length > 0) setTransactions(txs);
    });

    // 2. Pull fresh data from API
    sync();

    // 3. Track online/offline
    const online = navigator.onLine;
    setOnline(online);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", () => setOnline(false));

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", () => setOnline(false));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}

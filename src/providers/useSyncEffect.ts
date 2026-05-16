"use client";

import { useEffect } from "react";
import { useTransactionsStore } from "@/store/transactionsStore";
import { useNetworkStore } from "@/store/networkStore";
import {
  getLocalTransactions,
  pullTransactions,
  flushQueue,
  pendingCount,
  conflictCount,
} from "@/lib/offline";

// Fire email import in the background if: enabled + at least one filter set +
// last run was more than 23 hours ago (≈ daily). Uses the existing browser
// session so no cron auth issues. Fire-and-forget, never throws.
async function triggerEmailImportIfDue(): Promise<void> {
  try {
    const res = await fetch("/api/email/config");
    if (!res.ok) return;
    const config = await res.json() as {
      enabled: boolean;
      fromContains: string[];
      lastRun: string | null;
    };

    if (!config.enabled || config.fromContains.length === 0) return;

    const hoursSinceLastRun = config.lastRun
      ? (Date.now() - new Date(config.lastRun).getTime()) / 3_600_000
      : Infinity;

    if (hoursSinceLastRun >= 23) {
      fetch("/api/email/fetch", { method: "POST" }).catch(() => {});
    }
  } catch {
    // Never fail the sync because of email import
  }
}

export function useSyncEffect() {
  const { setTransactions, setSyncing } = useTransactionsStore();
  const { setOnline, setPendingCount, setConflictCount } = useNetworkStore();

  async function sync() {
    if (useTransactionsStore.getState().syncing) return;
    setSyncing(true);
    try {
      const { transactions, total, hasMore } = await pullTransactions(1);
      setTransactions(transactions, total, hasMore);
    } catch (err) {
      if (err instanceof Error && (err.message === "auth_expired" || err.message === "aborted")) return;
    } finally {
      setSyncing(false);
    }
    // Trigger email import daily, fire-and-forget, never blocks sync
    triggerEmailImportIfDue().catch(() => {});
  }

  async function goOnline() {
    setOnline(true);
    let lastCount = -1;
    while (true) {
      const result = await flushQueue();
      if (result.authExpired) { setPendingCount(0); return; }
      const count = await pendingCount();
      setPendingCount(count);
      if (count === 0 || count === lastCount) break;
      lastCount = count;
    }
    // Refresh conflict count after flush — new conflicts may have been recorded
    setConflictCount(await conflictCount());
    await sync();
  }

  useEffect(() => {
    (async () => {
      try {
        const localTxs = await getLocalTransactions();
        // Local cache has no total/hasMore metadata — set conservatively
        if (localTxs.length > 0) setTransactions(localTxs, localTxs.length, false);
        const count = await pendingCount();
        if (count > 0) setPendingCount(count);
        const conflicts = await conflictCount();
        if (conflicts > 0) setConflictCount(conflicts);
      } catch (err) {
        console.error("SyncProvider: failed to load local data:", err);
      }

      if (navigator.onLine) {
        await goOnline();
      } else {
        setOnline(false);
      }
    })();

    const handleOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", handleOffline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

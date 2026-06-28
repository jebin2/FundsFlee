"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Transaction } from "@/types";
import type { DuplicateGroup } from "@/features/transactions/utils/list";
import { duplicatesApi } from "@/lib/api/duplicates";
import { transactionsApi } from "@/lib/api/transactions";

export function useDuplicateResolution(loadData: () => Promise<Transaction[]>) {
  const [dupChecking, setDupChecking] = useState(false);
  const [dupError, setDupError] = useState<string | null>(null);
  const [activeDupGroup, setActiveDupGroup] = useState<DuplicateGroup | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  // Poll /api/cron/status until dedup_running_at is cleared
  const startPolling = useCallback(() => {
    stopPolling();
    let ticks = 0;
    pollRef.current = setInterval(async () => {
      if (++ticks > 36) { stopPolling(); setDupChecking(false); return; } // 6 min max
      try {
        const res = await fetch("/api/cron/status");
        if (!res.ok) return;
        const data = await res.json() as { dedup: { runningAt: string | null } };
        if (!data.dedup.runningAt) {
          stopPolling();
          setDupChecking(false);
          await loadData();
        }
      } catch { /* network blip — keep polling */ }
    }, 10_000);
  }, [loadData]);

  // On mount: check if dedup is already running server-side (survives page reload)
  useEffect(() => {
    fetch("/api/cron/status")
      .then((r) => r.json())
      .then((data: { dedup: { runningAt: string | null } }) => {
        if (data.dedup.runningAt) {
          setDupChecking(true);
          startPolling();
        }
      })
      .catch(() => {});
    return () => stopPolling();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function triggerDupDetect() {
    if (dupChecking) return;
    setDupChecking(true);
    setDupError(null);
    try {
      const res = await duplicatesApi.detect();
      const data = await res.json() as { started?: boolean; skipped?: boolean };
      if (data.skipped) {
        // Already ran recently — just refresh current data
        setDupChecking(false);
        await loadData();
      } else if (data.started) {
        // BG job started — poll sheet until dedup_running_at clears
        startPolling();
      } else {
        setDupChecking(false);
      }
    } catch {
      setDupError("Network error — please try again.");
      setDupChecking(false);
    }
  }

  async function resolveDuplicate(tx: Transaction, action: "keep" | "remove") {
    if (action === "remove") {
      // Use DELETE so the server also clears orphaned is_duplicate flags on
      // any transactions that point to this one as their duplicate original.
      await transactionsApi.delete(tx.id);
    } else {
      await transactionsApi.update(tx.id, { is_duplicate: false, duplicate_ref: undefined });
    }
    setActiveDupGroup(null);
    await loadData();
  }

  async function dismissGroup(group: DuplicateGroup) {
    await Promise.all(
      group.duplicates.map((t) =>
        transactionsApi.update(t.id, { is_duplicate: false, duplicate_ref: undefined })
      )
    );
    setActiveDupGroup(null);
    await loadData();
  }

  return { dupChecking, dupError, activeDupGroup, setActiveDupGroup, triggerDupDetect, resolveDuplicate, dismissGroup };
}

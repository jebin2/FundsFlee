"use client";

import { useEffect, useRef, useCallback } from "react";
import type { Transaction } from "@/types";
import { receiptsApi } from "@/lib/api/receipts";

// Dispatch a queued transaction to the correct background processor based on source.
async function processTransaction(tx: Transaction, region: string): Promise<void> {
  if (tx.source === "sms" || tx.source === "manual") {
    await fetch(`/api/parse/text/process?txId=${tx.id}&region=${encodeURIComponent(region)}`, { method: "POST" });
  } else if (tx.source === "import") {
    await fetch(`/api/parse/statement/process?txId=${tx.id}`, { method: "POST" });
  } else {
    // receipt (default)
    await receiptsApi.process(tx.id, region);
  }
}

export function useReceiptProcessingPoller(
  transactions: Transaction[],
  isOnline: boolean,
  loadData: () => Promise<Transaction[]>
) {
  const region = typeof window !== "undefined" ? localStorage.getItem("region") ?? "" : "";
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processingRef = useRef<Set<string>>(new Set());

  const triggerProcessing = useCallback(
    async (txs: Transaction[]) => {
      if (processingRef.current.size > 0) return;
      const tx = txs.find((t) => t.status === "queued" && !processingRef.current.has(t.id));
      if (!tx) return;
      processingRef.current.add(tx.id);
      processTransaction(tx, region).finally(() => processingRef.current.delete(tx.id));
    },
    [region]
  );

  useEffect(() => {
    const hasInFlight = transactions.some(
      (t) => t.status === "queued" || t.status === "processing" || t.status === "merging"
    );
    const shouldPoll = hasInFlight && isOnline;

    if (shouldPoll && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const txs = await loadData();
        triggerProcessing(txs);
        const stillInFlight = txs.some(
          (t) => t.status === "queued" || t.status === "processing" || t.status === "merging"
        );
        if (!stillInFlight && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 15000);
    }

    if (!shouldPoll && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [transactions, loadData, triggerProcessing, isOnline]);

  return { triggerProcessing, region };
}

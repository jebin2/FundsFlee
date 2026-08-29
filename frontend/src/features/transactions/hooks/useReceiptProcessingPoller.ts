"use client";

import { useEffect, useRef, useCallback } from "react";
import type { Transaction } from "@/types";
import { receiptsApi } from "@/lib/api/receipts";

// Dispatch a queued transaction to the correct background processor based on source.
// Every branch is named: a source with no processor is a bug in whatever queued
// the row, and sending it to the receipt processor only turns that bug into a
// misleading 404 about a missing receipt URL.
async function processTransaction(tx: Transaction, region: string): Promise<boolean> {
  if (tx.source === "sms" || tx.source === "manual") {
    await fetch(`/api/parse/text/process?txId=${tx.id}&region=${encodeURIComponent(region)}`, { method: "POST" });
  } else if (tx.source === "import") {
    await fetch(`/api/parse/statement/process?txId=${tx.id}`, { method: "POST" });
  } else if (tx.source === "receipt") {
    await receiptsApi.process(tx.id, region);
  } else {
    console.warn("[poller] queued transaction with no processor for source", {
      id: tx.id,
      source: tx.source,
    });
    return false;
  }
  return true;
}

export function useReceiptProcessingPoller(
  transactions: Transaction[],
  isOnline: boolean,
  loadData: () => Promise<Transaction[]>
) {
  const region = typeof window !== "undefined" ? localStorage.getItem("region") ?? "" : "";
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processingRef = useRef<Set<string>>(new Set());
  // Rows nothing knows how to process. They stay queued — only the server can
  // resolve that — but they must not be retried every 15s, and they must not
  // hold the poller open on their own.
  const unroutableRef = useRef<Set<string>>(new Set());

  const triggerProcessing = useCallback(
    async (txs: Transaction[]) => {
      if (processingRef.current.size > 0) return;
      const tx = txs.find(
        (t) =>
          t.status === "queued" &&
          !processingRef.current.has(t.id) &&
          !unroutableRef.current.has(t.id)
      );
      if (!tx) return;
      processingRef.current.add(tx.id);
      processTransaction(tx, region)
        .then((routed) => {
          if (!routed) unroutableRef.current.add(tx.id);
        })
        .finally(() => processingRef.current.delete(tx.id));
    },
    [region]
  );

  const inFlight = useCallback(
    (t: Transaction) =>
      (t.status === "queued" && !unroutableRef.current.has(t.id)) ||
      t.status === "processing" ||
      t.status === "merging",
    []
  );

  useEffect(() => {
    const hasInFlight = transactions.some(inFlight);
    const shouldPoll = hasInFlight && isOnline;

    if (shouldPoll && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const txs = await loadData();
        triggerProcessing(txs);
        const stillInFlight = txs.some(inFlight);
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
  }, [transactions, loadData, triggerProcessing, isOnline, inFlight]);

  return { triggerProcessing, region };
}

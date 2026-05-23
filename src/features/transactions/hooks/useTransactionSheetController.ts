"use client";

import { useState, useEffect } from "react";
import type { Transaction } from "@/types";
import { removeLocalTransaction, enqueueOp, pendingCount } from "@/lib/offline";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useTransactionsStore } from "@/store/transactionsStore";
import { useNetworkStore } from "@/store/networkStore";
import { useTransactions } from "@/hooks/useTransactions";
import { transactionsApi, transactionUrl } from "@/lib/api/transactions";
import { receiptsApi } from "@/lib/api/receipts";
import { duplicatesApi } from "@/lib/api/duplicates";
import { isInFlightStatus, isFailedStatus } from "@/domain/transactions/status";
import { decodeMergeMetadata } from "@/domain/transactions/metadata";

export interface TransactionSheetController {
  tx: Transaction;
  view: "detail" | "edit";
  setView: (v: "detail" | "edit") => void;
  showReceiptItems: boolean;
  setShowReceiptItems: (v: boolean) => void;
  deleting: boolean;
  retrying: boolean;
  error: string | null;
  isInFlight: boolean;
  isFailed: boolean;
  isMergeFail: boolean;
  handleDelete: () => Promise<void>;
  retryAI: () => Promise<void>;
  retryMerge: () => Promise<void>;
  onTxUpdated: (updated: Transaction) => void;
}

export function useTransactionSheetController(
  initialTx: Transaction,
  onClose: () => void
): TransactionSheetController {
  const isOnline = useOnlineStatus();
  const removeTransaction = useTransactionsStore((s) => s.removeTransaction);
  const { refresh } = useTransactions();

  const liveTx = useTransactionsStore((s) => s.transactions.find((t) => t.id === initialTx.id)) ?? initialTx;
  const [tx, setTx] = useState<Transaction>(initialTx);
  const [prevLiveTx, setPrevLiveTx] = useState(initialTx);
  if (liveTx !== prevLiveTx) {
    setPrevLiveTx(liveTx);
    setTx(liveTx);
  }
  const [view, setView] = useState<"detail" | "edit">(
    isFailedStatus(liveTx.status) ? "edit" : "detail"
  );
  const [showReceiptItems, setShowReceiptItems] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    if (!isInFlightStatus(tx.status) || !isOnline) return;
    const timer = setInterval(() => refresh(), 5000);
    return () => clearInterval(timer);
  }, [tx.status, isOnline, refresh]);

  async function handleDelete() {
    if (!confirm("Delete this transaction?")) return;
    setError(null);
    setDeleting(true);
    try {
      if (isOnline) {
        const res = await transactionsApi.delete(tx.id);
        if (!res.ok) throw new Error("Delete failed — please try again.");
        removeTransaction(tx.id);
        await removeLocalTransaction(tx.id);
      } else {
        removeTransaction(tx.id);
        await removeLocalTransaction(tx.id);
        await enqueueOp("DELETE", transactionUrl(tx.id), null);
        useNetworkStore.getState().setPendingCount(await pendingCount());
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  async function retryAI() {
    if (retrying) return;
    setError(null);
    setRetrying(true);
    try {
      const region = localStorage.getItem("region") ?? "";
      let res: Response;
      if (tx.source === "sms" || tx.source === "manual") {
        res = await fetch(`/api/parse/text/process?txId=${tx.id}&region=${encodeURIComponent(region)}`, { method: "POST" });
      } else if (tx.source === "import") {
        res = await fetch(`/api/parse/statement/process?txId=${tx.id}`, { method: "POST" });
      } else {
        res = await receiptsApi.process(tx.id, region);
      }
      if (!res.ok) throw new Error("Retry failed — please try again.");
      setTx((prev) => ({ ...prev, status: "processing" }));
      setView("detail");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  }

  async function retryMerge() {
    if (retrying) return;
    setError(null);
    setRetrying(true);
    try {
      const res = await duplicatesApi.merge(decodeMergeMetadata(tx.notes));
      if (!res.ok) throw new Error("Retry failed — please try again.");
      setTx((prev) => ({ ...prev, status: "merging" }));
      setView("detail");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  }

  function onTxUpdated(updated: Transaction) {
    setTx(updated);
    setView("detail");
  }

  return {
    tx, view, setView,
    showReceiptItems, setShowReceiptItems,
    deleting, retrying, error,
    isInFlight: isInFlightStatus(tx.status),
    isFailed: isFailedStatus(tx.status),
    isMergeFail: tx.status === "merge_failed",
    handleDelete, retryAI, retryMerge, onTxUpdated,
  };
}

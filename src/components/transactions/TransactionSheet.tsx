"use client";

import { useState, useEffect } from "react";
import type { Transaction } from "@/types";
import { formatINR, categoryIcons } from "@/components/TransactionRow";
import { EditForm } from "@/components/transactions/EditForm";
import { ReceiptItemsPopup } from "@/components/transactions/ReceiptItemsPopup";
import { removeLocalTransaction, enqueueOp, pendingCount } from "@/lib/offline";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useAppStore } from "@/store";
import { useTransactions } from "@/hooks/useTransactions";

// ── InFlight placeholder ──────────────────────────────────────────────────────

function InFlightView({ status }: { status: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 px-5 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "var(--color-primary-fixed)" }}>
        <span className="material-symbols-outlined animate-spin" style={{ fontSize: 32, color: "var(--color-primary)" }}>progress_activity</span>
      </div>
      <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-on-surface)" }}>
        {status === "queued" ? "Waiting to process…" : "Reading your receipt…"}
      </p>
      <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)", maxWidth: 280 }}>
        AI is extracting details from your receipt. Usually under a minute.
      </p>
    </div>
  );
}

// ── Sheet ─────────────────────────────────────────────────────────────────────

interface TransactionSheetProps {
  tx: Transaction;
  onClose: () => void;
}

export function TransactionSheet({ tx: initialTx, onClose }: TransactionSheetProps) {
  const isOnline = useOnlineStatus();
  const removeTransaction = useAppStore((s) => s.removeTransaction);
  const { refresh } = useTransactions();

  // Always read the latest version from the store so in-flight updates reflect live
  const liveTx = useAppStore((s) => s.transactions.find((t) => t.id === initialTx.id)) ?? initialTx;
  const [tx, setTx] = useState<Transaction>(liveTx);
  const [view, setView] = useState<"detail" | "edit">(liveTx.status === "failed" ? "edit" : "detail");
  const [showReceiptItems, setShowReceiptItems] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep local tx in sync with store (SyncProvider polling updates the store)
  useEffect(() => {
    setTx(liveTx);
  }, [liveTx]);

  // Poll API while in-flight and online — refresh updates the store which trickles down
  useEffect(() => {
    if (!["queued", "processing"].includes(tx.status ?? "") || !isOnline) return;
    const timer = setInterval(() => refresh(), 5000);
    return () => clearInterval(timer);
  }, [tx.status, isOnline, refresh]);

  async function handleDelete() {
    if (!confirm("Delete this transaction?")) return;
    setError(null);
    setDeleting(true);
    try {
      if (isOnline) {
        const res = await fetch(`/api/transactions/${tx.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Delete failed — please try again.");
        removeTransaction(tx.id);
        await removeLocalTransaction(tx.id);
      } else {
        removeTransaction(tx.id);
        await removeLocalTransaction(tx.id);
        await enqueueOp("DELETE", `/api/transactions/${tx.id}`, null);
        useAppStore.getState().setPendingCount(await pendingCount());
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
    const region = localStorage.getItem("region") ?? "";
    await fetch("/api/receipts/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txId: tx.id, region }),
    });
    setTx((prev) => ({ ...prev, status: "processing" }));
    setView("detail");
    setRetrying(false);
  }

  const isInFlight = tx.status === "queued" || tx.status === "processing";
  const isFailed = tx.status === "failed";
  const heroColor = isInFlight ? "var(--color-secondary)" : isFailed ? "var(--color-error)" : "var(--color-primary)";

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
        onClick={onClose} />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-3xl overflow-hidden"
        style={{ background: "var(--color-surface)", maxHeight: "92dvh" }}>

        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--color-outline-variant)" }} />
        </div>

        {/* Hero */}
        <div className="px-5 pt-3 pb-5 flex-shrink-0" style={{ background: heroColor }}>
          <div className="flex items-center gap-3 mb-4">
            <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.15)" }}>
              <span className="material-symbols-outlined text-white" style={{ fontSize: 20 }}>close</span>
            </button>
            <h2 style={{ fontSize: 17, fontWeight: 600, color: "#fff" }}>Transaction</h2>
            {!isInFlight && !isFailed && (
              <button onClick={() => setView(view === "edit" ? "detail" : "edit")}
                className="ml-auto w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.15)" }}>
                <span className="material-symbols-outlined text-white" style={{ fontSize: 20 }}>
                  {view === "edit" ? "close" : "edit"}
                </span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.15)" }}>
              {isInFlight
                ? <span className="material-symbols-outlined text-white animate-spin" style={{ fontSize: 28 }}>progress_activity</span>
                : <span className="material-symbols-outlined text-white" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>
                    {isFailed ? "receipt_long" : (categoryIcons[tx.category] ?? "category")}
                  </span>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate" style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>
                {isInFlight ? (tx.status === "queued" ? "In queue…" : "Processing…") : (tx.item_name || tx.merchant)}
              </p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                {isInFlight ? "AI reading receipt" : isFailed ? "AI could not read receipt"
                  : tx.item_name ? `${tx.merchant} · ${tx.category}` : tx.category}
              </p>
            </div>
          </div>
          {!isInFlight && (
            <p style={{ fontSize: 36, fontWeight: 700, color: isFailed ? "rgba(255,255,255,0.4)" : "#fff", letterSpacing: "-0.02em" }} className="mt-3">
              {isFailed ? "₹—" : formatINR(tx.amount)}
            </p>
          )}
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">
          {isInFlight && <InFlightView status={tx.status!} />}

          {!isInFlight && view === "edit" && (
            <>
              {isFailed && (
                <div className="mx-5 mt-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2 px-4 py-3 rounded-2xl"
                    style={{ background: "var(--color-error-container)" }}>
                    <span className="material-symbols-outlined" style={{ color: "var(--color-error)", fontSize: 18 }}>error</span>
                    <p style={{ fontSize: 13, color: "var(--color-on-error-container)" }}>
                      AI couldn&apos;t read this receipt. Fill in details below or retry.
                    </p>
                  </div>
                  <button onClick={retryAI} disabled={retrying}
                    className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium"
                    style={{ background: "var(--color-secondary-container)", color: "var(--color-on-secondary-container)", opacity: retrying ? 0.6 : 1, cursor: "pointer" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>auto_fix_high</span>
                    {retrying ? "Retrying…" : "Retry AI"}
                  </button>
                </div>
              )}
              <EditForm tx={tx} onSaved={(updated) => { setTx(updated); setView("detail"); }} />
            </>
          )}

          {!isInFlight && view === "detail" && !isFailed && (
            <div className="px-5 py-4 flex flex-col gap-3 pb-8">
              <div className="rounded-2xl overflow-hidden border"
                style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
                {[
                  ...(tx.item_name ? [{ label: "Item", value: tx.item_name }] : []),
                  ...(tx.quantity ? [{ label: "Quantity", value: tx.quantity }] : []),
                  { label: "Merchant", value: tx.merchant },
                  { label: "Date", value: new Date(tx.date).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) },
                  { label: "Time", value: tx.time || "—" },
                  { label: "Payment", value: tx.payment_method },
                  { label: "Source", value: tx.source },
                  ...(tx.notes ? [{ label: "Notes", value: tx.notes }] : []),
                  ...(tx.tags?.length ? [{ label: "Tags", value: tx.tags.join(", ") }] : []),
                ].map(({ label, value }, i, arr) => (
                  <div key={label} className="flex justify-between items-center px-4 py-3.5"
                    style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--color-surface-variant)" : "none" }}>
                    <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>{label}</p>
                    <p style={{ fontSize: 14, fontWeight: 500, color: "var(--color-on-surface)", maxWidth: "60%", textAlign: "right" }}>{value}</p>
                  </div>
                ))}
              </div>

              {tx.receipt_id && (
                <button onClick={() => setShowReceiptItems(true)}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border w-full text-left"
                  style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)", cursor: "pointer" }}>
                  <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20, fontVariationSettings: "'FILL' 1" }}>receipt</span>
                  <p style={{ fontSize: 14, fontWeight: 500, color: "var(--color-primary)" }}>View all items from this receipt</p>
                  <span className="material-symbols-outlined ml-auto" style={{ color: "var(--color-outline)", fontSize: 18 }}>expand_more</span>
                </button>
              )}

              {tx.receipt_url && (
                <a href={tx.receipt_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border"
                  style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
                  <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20 }}>receipt_long</span>
                  <p style={{ fontSize: 14, fontWeight: 500, color: "var(--color-primary)" }}>View original receipt image</p>
                  <span className="material-symbols-outlined ml-auto" style={{ color: "var(--color-outline)", fontSize: 18 }}>open_in_new</span>
                </a>
              )}

              {error && <p className="text-center" style={{ fontSize: 13, color: "var(--color-error)" }}>{error}</p>}

              <button onClick={handleDelete} disabled={deleting}
                className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
                style={{ background: "var(--color-error-container)", color: "var(--color-error)", opacity: deleting ? 0.6 : 1, cursor: "pointer" }}>
                <span className="material-symbols-outlined">delete</span>
                {deleting ? "Deleting…" : "Delete transaction"}
              </button>
            </div>
          )}

          {/* Delete for in-flight/failed */}
          {(isInFlight || isFailed) && (
            <div className="px-5 py-4">
              {error && <p className="text-center mb-3" style={{ fontSize: 13, color: "var(--color-error)" }}>{error}</p>}
              <button onClick={handleDelete} disabled={deleting}
                className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
                style={{ background: "var(--color-error-container)", color: "var(--color-error)", opacity: deleting ? 0.6 : 1, cursor: "pointer" }}>
                <span className="material-symbols-outlined">delete</span>
                {deleting ? "Deleting…" : "Delete transaction"}
              </button>
            </div>
          )}
        </div>
      </div>

      {showReceiptItems && tx.receipt_id && (
        <ReceiptItemsPopup receiptId={tx.receipt_id} onClose={() => setShowReceiptItems(false)} />
      )}
    </>
  );
}

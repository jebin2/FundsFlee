"use client";

import { useState, useEffect, useRef } from "react";
import type { Transaction } from "@/types";
import { formatINR, categoryIcons } from "@/components/TransactionRow";
import { EditForm, type EditFormHandle } from "@/components/transactions/EditForm";
import { ReceiptItemsPopup } from "@/components/transactions/ReceiptItemsPopup";
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

// ── InFlight placeholder ──────────────────────────────────────────────────────

function InFlightView({ status }: { status: string }) {
  const isMerging = status === "merging";
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 px-5 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "var(--color-primary-fixed)" }}>
        <span className="material-symbols-outlined animate-spin" style={{ fontSize: 32, color: "var(--color-primary)" }}>
          {isMerging ? "merge" : "progress_activity"}
        </span>
      </div>
      <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-on-surface)" }}>
        {isMerging ? "Merging duplicates…" : status === "queued" ? "Waiting to process…" : "AI is processing…"}
      </p>
      <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)", maxWidth: 280 }}>
        {isMerging
          ? "AI is combining the best data from each duplicate entry."
          : "AI is reading and extracting details. Usually under a minute."}
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
  const removeTransaction = useTransactionsStore((s) => s.removeTransaction);
  const { refresh } = useTransactions();
  const editFormRef = useRef<EditFormHandle | null>(null);

  const liveTx = useTransactionsStore((s) => s.transactions.find((t) => t.id === initialTx.id)) ?? initialTx;
  const [tx, setTx] = useState<Transaction>(liveTx);
  const [view, setView] = useState<"detail" | "edit">(
    isFailedStatus(liveTx.status) ? "edit" : "detail"
  );
  const [showReceiptItems, setShowReceiptItems] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setTx(liveTx); }, [liveTx]);

  // Lock body scroll while sheet is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Poll API while in-flight and online
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
      // Re-enqueue the same merge job using the stored source IDs
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

  const isInFlight  = isInFlightStatus(tx.status);
  const isFailed    = isFailedStatus(tx.status);
  const isMergeFail = tx.status === "merge_failed";
  const heroColor = isInFlight ? "var(--color-secondary)" : isFailed ? "var(--color-error)" : "var(--color-primary)";

  // ── Hero action buttons (right side) ──────────────────────────────────────
  const heroActions = (() => {
    const deleteBtn = (
      <button onClick={handleDelete} disabled={deleting}
        className="w-9 h-9 rounded-full flex items-center justify-center"
        style={{ background: "rgba(255,255,255,0.15)", opacity: deleting ? 0.5 : 1 }}>
        <span className="material-symbols-outlined text-white" style={{ fontSize: 20 }}>delete</span>
      </button>
    );
    const saveBtn = (
      <button onClick={() => editFormRef.current?.save()}
        className="w-9 h-9 rounded-full flex items-center justify-center"
        style={{ background: "rgba(255,255,255,0.3)" }}>
        <span className="material-symbols-outlined text-white" style={{ fontSize: 20 }}>check</span>
      </button>
    );
    const cancelBtn = (
      <button onClick={() => setView("detail")}
        className="w-9 h-9 rounded-full flex items-center justify-center"
        style={{ background: "rgba(255,255,255,0.15)" }}>
        <span className="material-symbols-outlined text-white" style={{ fontSize: 20 }}>close</span>
      </button>
    );
    const editBtn = (
      <button onClick={() => setView("edit")}
        className="w-9 h-9 rounded-full flex items-center justify-center"
        style={{ background: "rgba(255,255,255,0.15)" }}>
        <span className="material-symbols-outlined text-white" style={{ fontSize: 20 }}>edit</span>
      </button>
    );

    if (isInFlight) return <div className="flex gap-2">{deleteBtn}</div>;
    if (isFailed)   return <div className="flex gap-2">{deleteBtn}{saveBtn}</div>;
    if (view === "edit") return <div className="flex gap-2">{cancelBtn}{saveBtn}</div>;
    return <div className="flex gap-2">{deleteBtn}{editBtn}</div>;
  })();

  return (
    <>
      {/* Backdrop — z-[60] covers the bottom nav (z-50) so nav is unreachable while sheet is open */}
      <div className="fixed inset-0 z-[60]" style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
        onClick={onClose} />

      {/* Sheet — z-[70] sits above the backdrop */}
      <div className="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-3xl overflow-hidden md:left-1/2 md:right-auto md:w-full md:max-w-2xl md:-translate-x-1/2"
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
            <h2 style={{ fontSize: 17, fontWeight: 600, color: "#fff", flex: 1 }}>Transaction</h2>
            {heroActions}
          </div>

          {error && (
            <p className="mb-3 text-center" style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "4px 10px" }}>
              {error}
            </p>
          )}

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
                {isInFlight
                  ? (tx.status === "merging" ? "Merging…" : tx.status === "queued" ? "In queue…" : "Processing…")
                  : (tx.item_name || tx.merchant)}
              </p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                {isInFlight
                  ? (tx.status === "merging" ? "AI merging duplicates" : "AI reading receipt")
                  : isFailed
                  ? (isMergeFail ? "Merge failed" : "AI could not read receipt")
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
                      {isMergeFail
                        ? "AI couldn’t merge these duplicates. Tap retry or resolve manually."
                        : "AI couldn’t read this receipt. Fill in details below or retry."}
                    </p>
                  </div>
                  <button
                    onClick={isMergeFail ? retryMerge : retryAI}
                    disabled={retrying}
                    className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium"
                    style={{ background: "var(--color-secondary-container)", color: "var(--color-on-secondary-container)", opacity: retrying ? 0.6 : 1, cursor: "pointer" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                      {isMergeFail ? "merge" : "auto_fix_high"}
                    </span>
                    {retrying ? "Retrying…" : isMergeFail ? "Retry Merge" : "Retry AI"}
                  </button>
                </div>
              )}
              <EditForm ref={editFormRef} tx={tx} onSaved={(updated) => { setTx(updated); setView("detail"); }} />
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
                  <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
                    {tx.source === "receipt" ? "receipt" : "list_alt"}
                  </span>
                  <p style={{ fontSize: 14, fontWeight: 500, color: "var(--color-primary)" }}>
                    {tx.source === "receipt" ? "View all items from this receipt" : "View all items from this order"}
                  </p>
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
            </div>
          )}
        </div>
      </div>

      {showReceiptItems && tx.receipt_id && (
        <ReceiptItemsPopup receiptId={tx.receipt_id} source={tx.source} onClose={() => setShowReceiptItems(false)} />
      )}
    </>
  );
}

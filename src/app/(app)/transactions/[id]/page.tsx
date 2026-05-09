"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Transaction } from "@/types";
import { formatINR, categoryIcons } from "@/components/TransactionRow";
import { ReceiptItemsPopup } from "@/components/transactions/ReceiptItemsPopup";
import { EditForm } from "@/components/transactions/EditForm";

function InFlightView({ status }: { status: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 px-5">
      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "var(--color-primary-fixed)" }}>
        <span className="material-symbols-outlined animate-spin" style={{ fontSize: 32, color: "var(--color-primary)" }}>progress_activity</span>
      </div>
      <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-on-surface)" }}>
        {status === "queued" ? "Waiting to process…" : "Reading your receipt…"}
      </p>
      <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)", textAlign: "center" }}>
        Claude is extracting transaction details from your receipt. This usually takes under a minute.
      </p>
    </div>
  );
}

function DetailContent({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editMode = searchParams.get("edit") === "true";

  const [tx, setTx] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [showReceiptItems, setShowReceiptItems] = useState(false);
  const [isEditing, setIsEditing] = useState(editMode);

  useEffect(() => {
    fetch("/api/transactions")
      .then((r) => r.json())
      .then((d) => {
        const found = (d.transactions ?? []).find((t: Transaction) => t.id === id);
        setTx(found ?? null);
        if (found?.status === "failed") setIsEditing(true);
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Poll while in-flight
  useEffect(() => {
    if (!tx || !["queued", "processing"].includes(tx.status ?? "")) return;
    const timer = setInterval(async () => {
      const d = await fetch("/api/transactions").then((r) => r.json());
      const found = (d.transactions ?? []).find((t: Transaction) => t.id === id);
      if (found) {
        setTx(found);
        if (found.status !== "queued" && found.status !== "processing") {
          clearInterval(timer);
          if (found.status === "failed") setIsEditing(true);
        }
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [tx?.status, id]);

  async function deleteTransaction() {
    if (!confirm("Delete this transaction?")) return;
    setDeleting(true);
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    router.back();
  }

  async function retryAI() {
    if (!tx || retrying) return;
    setRetrying(true);
    const region = localStorage.getItem("region") ?? "Chennai, India";
    await fetch("/api/receipts/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txId: tx.id, region }),
    });
    setTx((prev) => prev ? { ...prev, status: "processing" } : prev);
    setIsEditing(false);
    setRetrying(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
      </div>
    );
  }

  if (!tx) {
    return (
      <div className="flex flex-col items-center py-20 gap-4">
        <p style={{ fontSize: 18, color: "var(--color-on-surface-variant)" }}>Transaction not found</p>
        <button onClick={() => router.back()} style={{ color: "var(--color-primary)" }}>Go back</button>
      </div>
    );
  }

  const isInFlight = tx.status === "queued" || tx.status === "processing";
  const isFailed = tx.status === "failed";

  return (
    <div className="max-w-lg mx-auto flex flex-col">
      {/* Hero */}
      <div className="px-5 pt-4 pb-6 rounded-b-3xl" style={{ background: isInFlight ? "var(--color-secondary)" : isFailed ? "var(--color-error)" : "var(--color-primary)" }}>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)" }}>
            <span className="material-symbols-outlined text-white">arrow_back</span>
          </button>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>Transaction Detail</h1>
          {!isInFlight && !isFailed && (
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="ml-auto w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.15)" }}
            >
              <span className="material-symbols-outlined text-white">{isEditing ? "close" : "edit"}</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)" }}>
            {isInFlight ? (
              <span className="material-symbols-outlined text-white animate-spin" style={{ fontSize: 32 }}>progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-white" style={{ fontSize: 32, fontVariationSettings: "'FILL' 1" }}>
                {isFailed ? "receipt_long" : (categoryIcons[tx.category] ?? "category")}
              </span>
            )}
          </div>
          <div>
            <p style={{ fontSize: 24, fontWeight: 700, color: "#fff" }}>
              {isInFlight ? (tx.status === "queued" ? "In queue…" : "Processing…") : (tx.item_name || tx.merchant)}
            </p>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
              {isInFlight
                ? "Receipt uploaded · AI reading"
                : isFailed
                ? "AI could not read receipt"
                : tx.item_name
                ? `${tx.merchant} · ${tx.category}`
                : `${tx.category}${tx.subcategory ? ` · ${tx.subcategory}` : ""}`}
            </p>
          </div>
        </div>
        {!isInFlight && (
          <p style={{ fontSize: 40, fontWeight: 700, color: isFailed ? "rgba(255,255,255,0.4)" : "#fff", letterSpacing: "-0.02em" }} className="mt-4">
            {isFailed ? "₹—" : formatINR(tx.amount)}
          </p>
        )}
        {tx.is_duplicate && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,152,0,0.2)", border: "1px solid rgba(255,152,0,0.3)" }}>
            <span className="material-symbols-outlined" style={{ color: "#ffcc80", fontSize: 18 }}>warning</span>
            <p style={{ fontSize: 13, color: "#ffcc80" }}>Possible duplicate</p>
          </div>
        )}
      </div>

      {/* In-flight body */}
      {isInFlight && <InFlightView status={tx.status!} />}

      {/* Failed + edit form */}
      {!isInFlight && (isEditing || isFailed) && (
        <>
          {isFailed && (
            <div className="mx-5 mt-4 flex items-center gap-2 px-4 py-3 rounded-2xl" style={{ background: "var(--color-error-container)" }}>
              <span className="material-symbols-outlined" style={{ color: "var(--color-error)", fontSize: 18 }}>error</span>
              <p style={{ fontSize: 13, color: "var(--color-on-error-container)" }}>AI couldn&apos;t read this receipt. Fill in the details below or retry.</p>
            </div>
          )}
          {isFailed && (
            <div className="px-5 pt-4 flex gap-3">
              <button
                onClick={retryAI}
                disabled={retrying}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium"
                style={{ background: "var(--color-secondary-container)", color: "var(--color-on-secondary-container)", opacity: retrying ? 0.6 : 1 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{retrying ? "progress_activity" : "auto_fix_high"}</span>
                {retrying ? "Retrying…" : "Retry AI"}
              </button>
            </div>
          )}
          <EditForm tx={tx} onSaved={(updated) => { setTx(updated); setIsEditing(false); }} />
        </>
      )}

      {/* Normal detail view */}
      {!isInFlight && !isEditing && !isFailed && (
        <div className="px-5 py-4 flex flex-col gap-3">
          <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
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

          {/* Brought together — all items from this receipt */}
          {tx.receipt_id && (
            <button
              onClick={() => setShowReceiptItems(true)}
              className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border w-full text-left"
              style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}
            >
              <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20, fontVariationSettings: "'FILL' 1" }}>receipt</span>
              <p style={{ fontSize: 14, fontWeight: 500, color: "var(--color-primary)" }}>View all items from this receipt</p>
              <span className="material-symbols-outlined ml-auto" style={{ color: "var(--color-outline)", fontSize: 18 }}>expand_more</span>
            </button>
          )}

          {/* Receipt image link */}
          {tx.receipt_url && (
            <a href={tx.receipt_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border"
              style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
              <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20 }}>receipt_long</span>
              <p style={{ fontSize: 14, fontWeight: 500, color: "var(--color-primary)" }}>View original receipt image</p>
              <span className="material-symbols-outlined ml-auto" style={{ color: "var(--color-outline)", fontSize: 18 }}>open_in_new</span>
            </a>
          )}

          {/* Delete */}
          <button onClick={deleteTransaction} disabled={deleting}
            className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 mt-4"
            style={{ background: "var(--color-error-container)", color: "var(--color-error)", opacity: deleting ? 0.6 : 1 }}>
            <span className="material-symbols-outlined">delete</span>
            {deleting ? "Deleting…" : "Delete transaction"}
          </button>
        </div>
      )}

      {/* Receipt items popup */}
      {showReceiptItems && tx.receipt_id && (
        <ReceiptItemsPopup receiptId={tx.receipt_id} onClose={() => setShowReceiptItems(false)} />
      )}

      {/* Delete for in-flight/failed too */}
      {(isInFlight || isFailed) && (
        <div className="px-5 pb-8 mt-auto pt-4">
          <button
            onClick={deleteTransaction}
            disabled={deleting}
            className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
            style={{ background: "var(--color-error-container)", color: "var(--color-error)", opacity: deleting ? 0.6 : 1 }}
          >
            <span className="material-symbols-outlined">delete</span>
            {deleting ? "Deleting…" : "Delete transaction"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { params.then((p) => setId(p.id)); }, [params]);
  if (!id) return null;
  return <Suspense><DetailContent id={id} /></Suspense>;
}

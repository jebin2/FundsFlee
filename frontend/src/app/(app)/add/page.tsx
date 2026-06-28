"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatINR } from "@/lib/format/currency";
import { useCreateTransaction } from "@/features/transactions/hooks/useCreateTransaction";
import { useManualTransactionForm } from "@/features/transactions/hooks/useManualTransactionForm";
import { useSmartDefaults } from "@/features/transactions/hooks/useSmartDefaults";
import { ManualTransactionFields } from "@/features/transactions/components/ManualTransactionFields";

const NUMPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

export default function AddPage() {
  const router = useRouter();
  const { createTransaction, saving } = useCreateTransaction();
  const form = useManualTransactionForm();
  const { recentMerchants, getCategoryForMerchant } = useSmartDefaults();
  const amountDisplayRef = useRef<HTMLDivElement>(null);
  const [amountHidden, setAmountHidden] = useState(false);

  useEffect(() => {
    const el = amountDisplayRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setAmountHidden(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  async function handleSave() {
    if (saving) return;
    const tx = form.buildTransaction();
    if (!tx) return;
    const error = await createTransaction(tx);
    if (error) form.setError(error);
  }

  return (
    <div className="max-w-lg mx-auto flex flex-col min-h-[calc(100dvh-80px)]">
      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-5 pt-10 pb-3" style={{ background: "var(--color-background)" }}>
        <button onClick={() => router.back()} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ background: "var(--color-surface-container)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>arrow_back</span>
        </button>
        <h1 className="flex-1 font-semibold" style={{ fontSize: 20 }}>Add Expense</h1>
        {amountHidden && (
          <span className="font-semibold" style={{ fontSize: 16, color: "var(--color-on-surface)" }}>
            {form.displayAmount > 0 ? formatINR(form.displayAmount) : "₹0"}
          </span>
        )}
        <button onClick={handleSave} disabled={saving} className="w-9 h-9 flex items-center justify-center rounded-xl"
          style={{ background: "var(--color-primary)", opacity: saving ? 0.6 : 1 }}>
          {saving
            ? <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />
            : <span className="material-symbols-outlined" style={{ color: "#fff", fontSize: 20 }}>check</span>}
        </button>
      </div>

      {/* Amount display */}
      <div ref={amountDisplayRef} className="flex flex-col items-center py-8 px-5">
        <p style={{ fontSize: 13, color: "var(--color-outline)", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>Amount (₹)</p>
        <div className={`flex items-baseline gap-2 mt-2 px-6 py-2 rounded-2xl transition-all ${form.submitted && (!form.amount || parseFloat(form.amount) <= 0) ? "ring-2 ring-red-500" : ""}`}>
          <span style={{ fontSize: 48, fontWeight: 700, color: form.displayAmount > 0 ? "var(--color-on-background)" : "var(--color-outline-variant)" }}>
            {form.displayAmount > 0 ? formatINR(form.displayAmount) : "₹0"}
          </span>
        </div>
        {form.error && <p style={{ fontSize: 13, color: "var(--color-error)" }} className="mt-2">{form.error}</p>}
      </div>

      <ManualTransactionFields
        form={form}
        recentMerchants={recentMerchants}
        getCategoryForMerchant={getCategoryForMerchant}
      />

      {/* Numpad */}
      <div className="mt-auto px-5 pb-6 pt-4">
        <div className="grid grid-cols-3 gap-2 mb-4">
          {NUMPAD_KEYS.map((k) => (
            <button key={k} onClick={() => form.handleAmountKey(k)}
              className="flex items-center justify-center h-14 rounded-2xl font-semibold text-xl transition-transform active:scale-95"
              style={{
                background: k === "⌫" ? "var(--color-surface-container-high)" : "var(--color-surface-container)",
                color: k === "⌫" ? "var(--color-on-surface-variant)" : "var(--color-on-surface)",
              }}>
              {k}
            </button>
          ))}
        </div>
        <button onClick={handleSave} disabled={saving}
          className="hidden md:flex w-full py-4 rounded-2xl font-semibold items-center justify-center gap-2 transition-opacity"
          style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 16, opacity: saving ? 0.7 : 1, boxShadow: "0 8px 20px rgba(31,16,142,0.25)" }}>
          {saving
            ? <><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} /> Saving…</>
            : <><span className="material-symbols-outlined">check</span> Save Entry</>}
        </button>
      </div>
    </div>
  );
}

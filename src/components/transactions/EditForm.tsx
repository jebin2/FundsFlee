"use client";

import { useState } from "react";
import type { Transaction } from "@/types";
import { CATEGORIES, PAYMENT_METHODS } from "@/lib/constants";
import { useOfflineFetch } from "@/hooks/useOfflineFetch";
import { patchLocalTransaction } from "@/lib/offline";
import { useAppStore } from "@/store";

export function EditForm({
  tx,
  onSaved,
}: {
  tx: Transaction;
  onSaved: (updated: Transaction) => void;
}) {
  const [itemName, setItemName] = useState(tx.item_name || "");
  const [quantity, setQuantity] = useState(tx.quantity || "");
  const [merchant, setMerchant] = useState(tx.merchant === "Processing…" ? "" : tx.merchant);
  const [amount, setAmount] = useState(tx.amount > 0 ? String(tx.amount) : "");
  const [date, setDate] = useState(tx.date);
  const [category, setCategory] = useState(tx.category || "Others");
  const [paymentMethod, setPaymentMethod] = useState<import("@/types").PaymentMethod>(tx.payment_method || "Other");
  const [notes, setNotes] = useState(tx.notes || "");
  const [saving, setSaving] = useState(false);

  const { safeFetch } = useOfflineFetch();
  const updateTransaction = useAppStore((s) => s.updateTransaction);

  async function save() {
    if (saving || !itemName.trim() || !amount) return;
    setSaving(true);

    const updates: Partial<Transaction> = {
      item_name: itemName.trim(),
      quantity: quantity.trim() || undefined,
      merchant: merchant.trim() || "Unknown",
      amount: parseFloat(amount),
      date,
      category,
      payment_method: paymentMethod,
      notes: notes.trim() || undefined,
      status: "done",
      updated_at: new Date().toISOString(),
    };

    try {
      const res = await safeFetch(`/api/transactions/${tx.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        offlineBody: updates,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error((data as { error?: string }).error ?? "Save failed");
      }

      // Keep store and IndexedDB in sync regardless of online/offline
      updateTransaction(tx.id, updates);
      await patchLocalTransaction(tx.id, updates);
      onSaved({ ...tx, ...updates });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-5 py-4 flex flex-col gap-3">
      <div className="rounded-2xl p-4 flex flex-col gap-3 border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Fill in details manually
        </p>

        {[
          { label: "Item Name *", value: itemName, setter: setItemName, placeholder: "e.g. Full Fat Milk" },
          { label: "Quantity", value: quantity, setter: setQuantity, placeholder: "e.g. 500g, 2 pcs" },
          { label: "Merchant / Store", value: merchant, setter: setMerchant, placeholder: "e.g. Swiggy, Big Bazaar" },
          { label: "Amount (₹)", value: amount, setter: setAmount, placeholder: "0", type: "number" },
        ].map(({ label, value, setter, placeholder, type }) => (
          <div key={label} className="flex flex-col gap-1">
            <label style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>{label}</label>
            <input
              type={type ?? "text"}
              value={value}
              onChange={(e) => setter(e.target.value)}
              placeholder={placeholder}
              className="px-3 py-2.5 rounded-xl border outline-none"
              style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface)", color: "var(--color-on-surface)", fontSize: 15 }}
            />
          </div>
        ))}

        <div className="flex flex-col gap-1">
          <label style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2.5 rounded-xl border outline-none"
            style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface)", color: "var(--color-on-surface)", fontSize: 15 }} />
        </div>

        <div className="flex flex-col gap-1">
          <label style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-2.5 rounded-xl border outline-none"
            style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface)", color: "var(--color-on-surface)", fontSize: 15 }}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>Payment method</label>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as import("@/types").PaymentMethod)}
            className="px-3 py-2.5 rounded-xl border outline-none"
            style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface)", color: "var(--color-on-surface)", fontSize: 15 }}>
            {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="px-3 py-2.5 rounded-xl border outline-none resize-none"
            style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface)", color: "var(--color-on-surface)", fontSize: 15 }} />
        </div>
      </div>

      <button onClick={save} disabled={saving || !itemName.trim() || !amount}
        className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
        style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", opacity: saving || !itemName.trim() || !amount ? 0.5 : 1 }}>
        <span className="material-symbols-outlined">check</span>
        {saving ? "Saving…" : "Save transaction"}
      </button>
    </div>
  );
}

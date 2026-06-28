"use client";

import { useState, forwardRef, useImperativeHandle } from "react";
import type { Transaction } from "@/types";
import { CATEGORIES, PAYMENT_METHODS } from "@/lib/constants";
import { useOfflineFetch } from "@/hooks/useOfflineFetch";
import { patchLocalTransaction } from "@/lib/offline";
import { useTransactionsStore } from "@/store/transactionsStore";

export interface EditFormHandle {
  save: () => void;
}

export const EditForm = forwardRef<EditFormHandle, {
  tx: Transaction;
  onSaved: (updated: Transaction) => void;
}>(function EditForm({
  tx,
  onSaved,
}, ref) {
  const [itemName, setItemName] = useState(tx.item_name || "");
  const [quantity, setQuantity] = useState(tx.quantity || "");
  const [merchant, setMerchant] = useState(tx.merchant === "Processing…" ? "" : tx.merchant);
  const [amount, setAmount] = useState(tx.amount > 0 ? String(tx.amount) : "");
  const [date, setDate] = useState(tx.date);
  const [category, setCategory] = useState(tx.category || "Others");
  const [paymentMethod, setPaymentMethod] = useState<import("@/types").PaymentMethod>(tx.payment_method || "Other");
  const [notes, setNotes] = useState(tx.notes || "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { safeFetch } = useOfflineFetch();
  const updateTransaction = useTransactionsStore((s) => s.updateTransaction);

  useImperativeHandle(ref, () => ({ save }));

  async function save() {
    if (saving || !itemName.trim() || !amount || parseFloat(amount) <= 0) return;
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

    setSaveError(null);
    try {
      const res = await safeFetch(`/api/transactions/${tx.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        offlineBody: updates,
      });

      const data = await res.json().catch(() => ({ offline: true })) as { ok?: boolean; updates?: Partial<Transaction>; error?: string; offline?: boolean };

      if (!res.ok && !data.offline) {
        setSaveError(data.error ?? "Save failed — please try again.");
        return;
      }

      // Use server-confirmed updates when available; fall back to local updates
      const confirmed = data.updates ?? updates;
      updateTransaction(tx.id, confirmed);
      await patchLocalTransaction(tx.id, confirmed);
      onSaved({ ...tx, ...confirmed });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed — please try again.");
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
        {saveError && (
          <p style={{ fontSize: 13, color: "var(--color-error)", background: "var(--color-error-container)", padding: "8px 12px", borderRadius: 10 }}>
            {saveError}
          </p>
        )}

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

    </div>
  );
});

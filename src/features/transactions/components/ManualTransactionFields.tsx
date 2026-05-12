import { CATEGORIES, PAYMENT_METHODS } from "@/lib/constants";
import type { ManualTransactionFormState } from "@/features/transactions/hooks/useManualTransactionForm";

interface ManualTransactionFieldsProps {
  form: ManualTransactionFormState;
}

export function ManualTransactionFields({ form }: ManualTransactionFieldsProps) {
  const inputBase = { background: "var(--color-surface-container)", color: "var(--color-on-surface)", outline: "none" };

  return (
    <div className="px-5 flex flex-col gap-3">
      <input
        type="text"
        placeholder="Item name *"
        value={form.itemName}
        onChange={(e) => { form.setItemName(e.target.value); if (form.submitted && e.target.value.trim()) form.setError(""); }}
        className="w-full px-4 py-3.5 rounded-2xl font-medium"
        style={{
          ...inputBase,
          fontSize: 16,
          border: form.submitted && !form.itemName.trim() ? "2px solid var(--color-error)" : "2px solid transparent",
        }}
      />

      <div className="grid grid-cols-3 gap-3">
        <input type="text" placeholder="Qty (e.g. 500g)" value={form.quantity}
          onChange={(e) => form.setQuantity(e.target.value)}
          className="px-4 py-3 rounded-2xl" style={{ ...inputBase, fontSize: 14 }} />
        <input type="date" value={form.date}
          onChange={(e) => form.setDate(e.target.value)}
          className="px-4 py-3 rounded-2xl" style={{ ...inputBase, fontSize: 14 }} />
        <input type="time" value={form.time}
          onChange={(e) => form.setTime(e.target.value)}
          className="px-4 py-3 rounded-2xl" style={{ ...inputBase, fontSize: 14 }} />
      </div>

      <select value={form.category} onChange={(e) => form.setCategory(e.target.value)}
        className="px-4 py-3 rounded-2xl" style={{ ...inputBase, fontSize: 14 }}>
        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
      </select>

      <div className="flex gap-2 flex-wrap">
        {PAYMENT_METHODS.map((m) => (
          <button key={m} onClick={() => form.setPaymentMethod(m)}
            className="px-4 py-2 rounded-full text-sm font-medium transition-all"
            style={{
              background: m === form.paymentMethod ? "var(--color-primary)" : "var(--color-surface-container)",
              color: m === form.paymentMethod ? "var(--color-on-primary)" : "var(--color-on-surface-variant)",
            }}>
            {m}
          </button>
        ))}
      </div>

      <input type="text" placeholder="Shop / merchant (optional)" value={form.merchant}
        onChange={(e) => form.setMerchant(e.target.value)}
        className="w-full px-4 py-3 rounded-2xl" style={{ ...inputBase, fontSize: 14 }} />

      <input type="text" placeholder="Notes (optional)" value={form.notes}
        onChange={(e) => form.setNotes(e.target.value)}
        className="w-full px-4 py-3 rounded-2xl" style={{ ...inputBase, fontSize: 14 }} />
    </div>
  );
}

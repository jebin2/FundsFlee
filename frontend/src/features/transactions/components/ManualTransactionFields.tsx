import { CATEGORIES, PAYMENT_METHODS } from "@/lib/constants";
import type { RecurrencePeriod } from "@/types";

const RECURRENCE_OPTIONS: { value: RecurrencePeriod | ""; label: string }[] = [
  { value: "",        label: "One-time" },
  { value: "daily",   label: "Daily" },
  { value: "weekly",  label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly",  label: "Yearly" },
];
import type { ManualTransactionFormState } from "@/features/transactions/hooks/useManualTransactionForm";

interface ManualTransactionFieldsProps {
  form: ManualTransactionFormState;
  recentMerchants?: string[];
  getCategoryForMerchant?: (merchant: string) => string | null;
}

export function ManualTransactionFields({ form, recentMerchants = [], getCategoryForMerchant }: ManualTransactionFieldsProps) {
  const inputBase = { background: "var(--color-surface-container)", color: "var(--color-on-surface)", outline: "none" };

  // When the merchant input changes, auto-suggest a category if we know this merchant
  function handleMerchantChange(value: string) {
    form.setMerchant(value);
    if (getCategoryForMerchant && value.trim().length > 1) {
      const suggested = getCategoryForMerchant(value.trim());
      if (suggested) form.setCategory(suggested);
    }
  }

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

      {/* Recent merchant chips — shown when merchant field is empty */}
      {recentMerchants.length > 0 && (
        <div className="flex flex-col gap-2">
          <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500 }}>Recent</p>
          <div className="flex gap-2 flex-wrap">
            {recentMerchants.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => form.applyMerchant(m, getCategoryForMerchant?.(m) ?? undefined)}
                className="px-3 py-1.5 rounded-full text-sm font-medium transition-all"
                style={{
                  background: form.merchant === m ? "var(--color-primary)" : "var(--color-surface-container-high)",
                  color: form.merchant === m ? "var(--color-on-primary)" : "var(--color-on-surface-variant)",
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

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

      {/* Category — auto-suggested from merchant, always editable */}
      <select value={form.category} onChange={(e) => form.setCategory(e.target.value)}
        className="px-4 py-3 rounded-2xl" style={{ ...inputBase, fontSize: 14 }}>
        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
      </select>

      <div className="flex gap-2 flex-wrap">
        {PAYMENT_METHODS.map((m) => (
          <button key={m} type="button" onClick={() => form.setPaymentMethod(m)}
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
        onChange={(e) => handleMerchantChange(e.target.value)}
        className="w-full px-4 py-3 rounded-2xl" style={{ ...inputBase, fontSize: 14 }} />

      <input type="text" placeholder="Notes (optional)" value={form.notes}
        onChange={(e) => form.setNotes(e.target.value)}
        className="w-full px-4 py-3 rounded-2xl" style={{ ...inputBase, fontSize: 14 }} />

      {/* Recurrence */}
      <div className="flex flex-col gap-2">
        <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500 }}>Repeat</p>
        <div className="flex gap-2 flex-wrap">
          {RECURRENCE_OPTIONS.map(({ value, label }) => (
            <button key={value} type="button"
              onClick={() => form.setRecurrence(value as RecurrencePeriod | "")}
              className="px-4 py-2 rounded-full text-sm font-medium"
              style={{
                background: form.recurrence === value ? "var(--color-tertiary-container, var(--color-primary))" : "var(--color-surface-container)",
                color: form.recurrence === value ? "var(--color-on-tertiary-container, var(--color-on-primary))" : "var(--color-on-surface-variant)",
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

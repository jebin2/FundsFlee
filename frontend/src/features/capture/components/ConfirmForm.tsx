"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ParsedTransaction, PaymentMethod } from "@/types";
import { transactionsApi } from "@/lib/api/transactions";

interface ConfirmFormProps {
  parsed: ParsedTransaction;
  rawText: string;
  onBack: () => void;
}

export function ConfirmForm({ parsed, rawText, onBack }: ConfirmFormProps) {
  const router = useRouter();
  const [form, setForm] = useState(parsed);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof ParsedTransaction>(key: K, val: ParsedTransaction[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  const isUncertain = (field: string) => (form.uncertain_fields ?? []).includes(field);

  async function save() {
    setSaving(true);
    try {
      const tx = {
        id: crypto.randomUUID(),
        date: form.date, time: form.time, amount: form.amount,
        merchant: form.merchant, category: form.category,
        subcategory: form.subcategory, item_name: form.item_name,
        payment_method: form.payment_method,
        source: "sms" as const, raw_input: rawText, status: "done" as const,
      };
      const res = await transactionsApi.create(tx);
      if (res.ok) router.push("/transactions");
      else alert("Failed to save — please try again.");
    } catch {
      alert("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  function field(label: string, key: keyof ParsedTransaction, type = "text") {
    return (
      <div className="p-4 border-b" style={{ borderColor: "var(--color-surface-variant)" }}>
        <div className="flex items-center gap-2 mb-1">
          <label style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500 }}>{label}</label>
          {isUncertain(key as string) && (
            <span style={{ fontSize: 11, background: "#fff3e0", color: "#e65100", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>Verify</span>
          )}
        </div>
        <input
          type={type}
          value={String(form[key] ?? "")}
          onChange={(e) => update(key, e.target.value as ParsedTransaction[typeof key])}
          className="w-full bg-transparent focus:outline-none font-medium"
          style={{ fontSize: 16, color: "var(--color-on-surface)" }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-5 py-4 flex flex-col gap-4">
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "var(--color-primary-fixed)" }}>
        <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 18, fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
        <span style={{ fontSize: 13, color: "var(--color-primary)", fontWeight: 600 }}>Extracted by AI</span>
        <span className="ml-auto" style={{ fontSize: 12, color: "var(--color-outline)" }}>Confidence: {Math.round((form.confidence ?? 0) * 100)}%</span>
      </div>

      <div className="rounded-3xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
        {field("Merchant", "merchant")}
        {field("Item Name", "item_name")}
        <div className="p-4 border-b" style={{ borderColor: "var(--color-surface-variant)" }}>
          <label style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500 }}>Amount (₹)</label>
          <input type="number" value={form.amount} onChange={(e) => update("amount", parseFloat(e.target.value))}
            className="w-full bg-transparent focus:outline-none font-semibold"
            style={{ fontSize: 24, color: "var(--color-primary)" }} />
        </div>
        {field("Date", "date", "date")}
        {field("Category", "category")}
        <div className="p-4">
          <label style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500 }}>Payment Method</label>
          <div className="flex gap-2 flex-wrap mt-2">
            {(["UPI", "Card", "Cash", "NetBanking", "Other"] as PaymentMethod[]).map((m) => (
              <button key={m} onClick={() => update("payment_method", m)}
                className="px-3 py-1.5 rounded-full text-sm font-medium"
                style={{ background: form.payment_method === m ? "var(--color-primary)" : "var(--color-surface-container)", color: form.payment_method === m ? "#fff" : "var(--color-on-surface-variant)" }}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-2">
        <button onClick={onBack} className="flex-1 py-4 rounded-2xl font-semibold"
          style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", fontSize: 16 }}>Edit</button>
        <button onClick={save} disabled={saving} className="flex-2 py-4 px-8 rounded-2xl font-semibold flex items-center justify-center gap-2"
          style={{ background: "var(--color-primary)", color: "#fff", fontSize: 16, flex: 2, opacity: saving ? 0.7 : 1 }}>
          {saving
            ? <><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />Saving</>
            : <><span className="material-symbols-outlined">check</span>Save</>}
        </button>
      </div>
    </div>
  );
}

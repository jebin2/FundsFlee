"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Transaction, PaymentMethod } from "@/types";
import { CATEGORIES, PAYMENT_METHODS } from "@/lib/constants";

function formatINR(n: number) {
  return n === 0 ? "0" : n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export default function AddPage() {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("Food & Dining");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("UPI");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [time, setTime] = useState(new Date().toTimeString().slice(0, 5));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const displayAmount = amount ? parseFloat(amount) : 0;

  function handleAmountKey(key: string) {
    if (key === "⌫") {
      setAmount((a) => a.slice(0, -1));
    } else if (key === "." && amount.includes(".")) {
      return;
    } else {
      setAmount((a) => (a.length < 10 ? a + key : a));
    }
  }

  async function handleSave() {
    setSubmitted(true);
    if (!amount || parseFloat(amount) <= 0) { setError("Enter an amount"); return; }
    if (!itemName.trim()) { setError("Enter an item name"); return; }
    setError("");
    setSaving(true);

    const tx: Partial<Transaction> = {
      id: crypto.randomUUID(),
      date, time, amount: parseFloat(amount),
      item_name: itemName.trim(),
      quantity: quantity.trim() || undefined,
      merchant: merchant.trim() || "Unknown",
      category,
      payment_method: paymentMethod,
      notes: notes.trim() || undefined,
      source: "manual",
    };

    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: tx }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];

  return (
    <div className="max-w-lg mx-auto flex flex-col min-h-[calc(100dvh-80px)]">
      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-30 flex items-center px-5 pt-10 pb-3" style={{ background: "var(--color-background)" }}>
        <button onClick={() => router.back()} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ background: "var(--color-surface-container)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>arrow_back</span>
        </button>
        <h1 className="ml-3 font-semibold" style={{ fontSize: 20 }}>Add Expense</h1>
      </div>

      {/* Amount display */}
      <div className="flex flex-col items-center py-8 px-5">
        <p style={{ fontSize: 13, color: "var(--color-outline)", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>Amount (₹)</p>
        <div className={`flex items-baseline gap-2 mt-2 px-6 py-2 rounded-2xl transition-all ${submitted && (!amount || parseFloat(amount) <= 0) ? "ring-2 ring-red-500" : ""}`}>
          <span style={{ fontSize: 48, fontWeight: 700, color: displayAmount > 0 ? "var(--color-on-background)" : "var(--color-outline-variant)" }}>
            ₹{displayAmount > 0 ? formatINR(displayAmount) : "0"}
          </span>
        </div>
        {error && <p style={{ fontSize: 13, color: "var(--color-error)" }} className="mt-2">{error}</p>}
      </div>

      {/* Item + details */}
      <div className="px-5 flex flex-col gap-3">
        {/* Item name — mandatory */}
        <input
          type="text"
          placeholder="Item name *"
          value={itemName}
          onChange={(e) => { setItemName(e.target.value); if (submitted && e.target.value.trim()) setError(""); }}
          className="w-full px-4 py-3.5 rounded-2xl font-medium"
          style={{
            background: "var(--color-surface-container)",
            color: "var(--color-on-surface)",
            fontSize: 16,
            outline: "none",
            border: submitted && !itemName.trim() ? "2px solid var(--color-error)" : "2px solid transparent",
          }}
        />

        {/* Quantity + Date/Time row */}
        <div className="grid grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="Qty (e.g. 500g)"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="px-4 py-3 rounded-2xl"
            style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", fontSize: 14, outline: "none" }}
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-4 py-3 rounded-2xl"
            style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", fontSize: 14, outline: "none" }}
          />
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="px-4 py-3 rounded-2xl"
            style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", fontSize: 14, outline: "none" }}
          />
        </div>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-4 py-3 rounded-2xl"
          style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", fontSize: 14, outline: "none" }}
        >
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>

        <div className="flex gap-2 flex-wrap">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              onClick={() => setPaymentMethod(m)}
              className="px-4 py-2 rounded-full text-sm font-medium transition-all"
              style={{
                background: m === paymentMethod ? "var(--color-primary)" : "var(--color-surface-container)",
                color: m === paymentMethod ? "var(--color-on-primary)" : "var(--color-on-surface-variant)",
              }}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Merchant — optional */}
        <input
          type="text"
          placeholder="Shop / merchant (optional)"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          className="w-full px-4 py-3 rounded-2xl"
          style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", fontSize: 14, outline: "none" }}
        />

        <input
          type="text"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full px-4 py-3 rounded-2xl"
          style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", fontSize: 14, outline: "none" }}
        />
      </div>

      {/* Numpad */}
      <div className="mt-auto px-5 pb-6 pt-4">
        <div className="grid grid-cols-3 gap-2 mb-4">
          {keys.map((k) => (
            <button
              key={k}
              onClick={() => handleAmountKey(k)}
              className="flex items-center justify-center h-14 rounded-2xl font-semibold text-xl transition-transform active:scale-95"
              style={{
                background: k === "⌫" ? "var(--color-surface-container-high)" : "var(--color-surface-container)",
                color: k === "⌫" ? "var(--color-on-surface-variant)" : "var(--color-on-surface)",
              }}
            >
              {k}
            </button>
          ))}
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-opacity"
          style={{
            background: "var(--color-primary)",
            color: "var(--color-on-primary)",
            fontSize: 16,
            opacity: saving ? 0.7 : 1,
            boxShadow: "0 8px 20px rgba(31,16,142,0.25)",
          }}
        >
          {saving ? (
            <><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} /> Saving…</>
          ) : (
            <><span className="material-symbols-outlined">check</span> Save Entry</>
          )}
        </button>
      </div>
    </div>
  );
}

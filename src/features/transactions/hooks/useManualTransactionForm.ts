"use client";

import { useState } from "react";
import type { Transaction, PaymentMethod } from "@/types";
import { todayISO } from "@/lib/date/iso";

export function useManualTransactionForm() {
  const [amount, setAmount] = useState("");
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("Food & Dining");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("UPI");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [notes, setNotes] = useState("");
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

  function buildTransaction(): Transaction | null {
    setSubmitted(true);
    if (!amount || parseFloat(amount) <= 0) { setError("Enter an amount"); return null; }
    if (!itemName.trim()) { setError("Enter an item name"); return null; }
    setError("");
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      date, time, amount: parseFloat(amount),
      item_name: itemName.trim(),
      quantity: quantity.trim() || undefined,
      merchant: merchant.trim() || "Unknown",
      category,
      payment_method: paymentMethod,
      notes: notes.trim() || undefined,
      source: "manual",
      created_at: now,
      updated_at: now,
      status: "done",
    };
  }

  return {
    amount, itemName, setItemName, quantity, setQuantity,
    merchant, setMerchant, category, setCategory,
    paymentMethod, setPaymentMethod, date, setDate,
    time, setTime, notes, setNotes,
    error, setError, submitted,
    displayAmount, handleAmountKey, buildTransaction,
  };
}

export type ManualTransactionFormState = ReturnType<typeof useManualTransactionForm>;

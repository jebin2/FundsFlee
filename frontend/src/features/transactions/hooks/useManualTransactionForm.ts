"use client";

import { useState } from "react";
import type { Transaction, PaymentMethod, RecurrencePeriod } from "@/types";
import { todayISO } from "@/lib/date/iso";
import { safeJsonParse } from "@/lib/safeJson";

function readPref<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  return safeJsonParse<T>(localStorage.getItem(key), fallback);
}

function savePref(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

export function useManualTransactionForm() {
  const [amount, setAmount] = useState("");
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState<string>(
    () => readPref("pref_category", "Food & Dining")
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    () => readPref("pref_payment_method", "UPI")
  );
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [notes, setNotes] = useState("");
  const [recurrence, setRecurrence] = useState<RecurrencePeriod | "">("");
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

  function setPaymentMethodAndSave(method: PaymentMethod) {
    setPaymentMethod(method);
    savePref("pref_payment_method", method);
  }

  function setCategoryAndSave(cat: string) {
    setCategory(cat);
    savePref("pref_category", cat);
  }

  // Called when a recent merchant chip is tapped — fills merchant and optionally category
  function applyMerchant(name: string, suggestedCategory?: string) {
    setMerchant(name);
    if (suggestedCategory) {
      setCategoryAndSave(suggestedCategory);
    }
  }

  function buildTransaction(): Transaction | null {
    setSubmitted(true);
    if (!amount || parseFloat(amount) <= 0) { setError("Enter an amount"); return null; }
    if (!itemName.trim()) { setError("Enter an item name"); return null; }
    setError("");
    // Persist last-used category for next time
    savePref("pref_category", category);
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
      recurrence: recurrence || undefined,
      source: "manual",
      created_at: now,
      updated_at: now,
      status: "done",
    };
  }

  return {
    amount, itemName, setItemName, quantity, setQuantity,
    merchant, setMerchant, category, setCategory: setCategoryAndSave,
    paymentMethod, setPaymentMethod: setPaymentMethodAndSave,
    date, setDate, time, setTime, notes, setNotes,
    recurrence, setRecurrence,
    error, setError, submitted,
    displayAmount, handleAmountKey, buildTransaction, applyMerchant,
  };
}

export type ManualTransactionFormState = ReturnType<typeof useManualTransactionForm>;

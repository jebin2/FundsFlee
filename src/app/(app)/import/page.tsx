"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatINR } from "@/lib/format/currency";
import { transactionsApi } from "@/lib/api/transactions";
import type { Transaction, PaymentMethod } from "@/types";

interface ParsedRow {
  date: string;
  amount: number;
  merchant: string;
  category: string;
  payment_method: string;
  notes: string | null;
}

type Step = "upload" | "confirm" | "importing" | "done";

export default function ImportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importedCount, setImportedCount] = useState(0);

  async function handleFile(file: File) {
    setParsing(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/parse/statement", { method: "POST", body: form });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Parsing failed");
      }
      const { transactions } = await res.json() as { transactions: ParsedRow[] };
      if (transactions.length === 0) {
        setError("No debit transactions found in this statement.");
        return;
      }
      setRows(transactions);
      setSelected(new Set(transactions.map((_, i) => i)));
      setStep("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    setStep("importing");
    const toImport = rows.filter((_, i) => selected.has(i));

    // Batch into groups of 5 to stay within Sheets API rate limits while
    // still being much faster than fully sequential (200 calls ≈ 100s).
    const BATCH = 5;
    for (let i = 0; i < toImport.length; i += BATCH) {
      const batch = toImport.slice(i, i + BATCH);
      await Promise.all(batch.map((row) => {
        const now = new Date().toISOString();
        const tx: Transaction = {
          id: crypto.randomUUID(),
          date: row.date,
          time: "00:00",
          amount: row.amount,
          merchant: row.merchant,
          category: row.category,
          payment_method: (row.payment_method as PaymentMethod) || "Other",
          notes: row.notes ?? undefined,
          source: "manual",
          created_at: now,
          updated_at: now,
          status: "done",
        };
        return transactionsApi.create(tx);
      }));
    }

    setImportedCount(toImport.length);
    setStep("done");
  }

  if (step === "done") {
    return (
      <div className="max-w-lg mx-auto px-5 pt-16 flex flex-col items-center gap-5 text-center">
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: "var(--color-primary-fixed)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 40, color: "var(--color-primary)" }}>check_circle</span>
        </div>
        <p style={{ fontSize: 22, fontWeight: 700, color: "var(--color-on-surface)" }}>Import complete!</p>
        <p style={{ fontSize: 15, color: "var(--color-on-surface-variant)" }}>
          {importedCount} transaction{importedCount !== 1 ? "s" : ""} added to your account.
        </p>
        <button onClick={() => router.push("/transactions")} className="mt-4 px-8 py-3.5 rounded-2xl font-semibold"
          style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 16 }}>
          View transactions
        </button>
      </div>
    );
  }

  if (step === "importing") {
    return (
      <div className="max-w-lg mx-auto px-5 pt-16 flex flex-col items-center gap-4 text-center">
        <div className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
          style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
        <p style={{ fontSize: 16, color: "var(--color-on-surface-variant)" }}>Importing transactions…</p>
      </div>
    );
  }

  if (step === "confirm") {
    const total = rows.filter((_, i) => selected.has(i)).reduce((s, r) => s + r.amount, 0);
    return (
      <div className="max-w-2xl mx-auto px-5 pt-6 pb-24 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep("upload")} className="w-9 h-9 flex items-center justify-center rounded-xl"
            style={{ background: "var(--color-surface-container)" }}>
            <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>arrow_back</span>
          </button>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--color-on-surface)" }}>Review transactions</h1>
            <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>
              {selected.size} of {rows.length} selected · {formatINR(total)}
            </p>
          </div>
          <button onClick={() => setSelected(new Set(rows.map((_, i) => i)))} className="ml-auto text-sm font-medium"
            style={{ color: "var(--color-primary)" }}>All</button>
          <button onClick={() => setSelected(new Set())} className="text-sm font-medium"
            style={{ color: "var(--color-outline)" }}>None</button>
        </div>

        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <button key={i} onClick={() => setSelected((prev) => {
              const next = new Set(prev);
              next.has(i) ? next.delete(i) : next.add(i);
              return next;
            })}
              className="flex items-center gap-3 px-4 py-3 rounded-2xl text-left w-full"
              style={{ background: "var(--color-surface-container-lowest)", border: `2px solid ${selected.has(i) ? "var(--color-primary)" : "var(--color-outline-variant)"}`, opacity: selected.has(i) ? 1 : 0.5 }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: selected.has(i) ? "var(--color-primary)" : "var(--color-surface-container)" }}>
                {selected.has(i)
                  ? <span className="material-symbols-outlined text-white" style={{ fontSize: 16 }}>check</span>
                  : <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-outline)" }}>remove</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium" style={{ fontSize: 14, color: "var(--color-on-surface)" }}>{row.merchant}</p>
                <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>{row.date} · {row.category}</p>
              </div>
              <p className="font-semibold flex-shrink-0" style={{ fontSize: 15, color: "var(--color-on-surface)" }}>{formatINR(row.amount)}</p>
            </button>
          ))}
        </div>

        <div className="fixed bottom-24 left-0 right-0 px-5 max-w-2xl mx-auto">
          <button onClick={handleImport} disabled={selected.size === 0}
            className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
            style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 16, opacity: selected.size === 0 ? 0.5 : 1 }}>
            <span className="material-symbols-outlined">file_upload</span>
            Import {selected.size} transaction{selected.size !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    );
  }

  // Upload step
  return (
    <div className="max-w-lg mx-auto px-5 pt-6 pb-8 flex flex-col gap-5">
      <div className="flex items-center gap-3 md:hidden">
        <button onClick={() => router.back()} className="w-9 h-9 flex items-center justify-center rounded-xl"
          style={{ background: "var(--color-surface-container)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>arrow_back</span>
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Import Statement</h1>
      </div>
      <h1 className="hidden md:block" style={{ fontSize: 24, fontWeight: 700, color: "var(--color-on-surface)" }}>Import Bank Statement</h1>

      <div className="rounded-3xl p-6 flex flex-col items-center gap-4 text-center border-2 border-dashed"
        style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "var(--color-primary-fixed)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 32, color: "var(--color-primary)" }}>picture_as_pdf</span>
        </div>
        <div>
          <p style={{ fontSize: 16, fontWeight: 600, color: "var(--color-on-surface)" }}>Upload your bank statement</p>
          <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)", marginTop: 4 }}>
            PDF format · AI extracts all debit transactions
          </p>
        </div>
        {error && <p style={{ fontSize: 13, color: "var(--color-error)" }}>{error}</p>}
        <button onClick={() => fileRef.current?.click()} disabled={parsing}
          className="px-8 py-3.5 rounded-2xl font-semibold flex items-center gap-2"
          style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 15, opacity: parsing ? 0.7 : 1 }}>
          {parsing
            ? <><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />Reading statement…</>
            : <><span className="material-symbols-outlined">upload_file</span>Choose PDF</>}
        </button>
        <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>

      <div className="rounded-2xl p-4 flex gap-3" style={{ background: "var(--color-primary-fixed)" }}>
        <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20, flexShrink: 0 }}>info</span>
        <p style={{ fontSize: 13, color: "var(--color-primary)" }}>
          Your PDF is sent to Claude AI for parsing and is not stored. Only debit transactions are imported — credits and balance rows are ignored.
        </p>
      </div>
    </div>
  );
}

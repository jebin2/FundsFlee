"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TransactionRow, formatINR } from "@/components/TransactionRow";
import { useTransactions } from "@/hooks/useTransactions";
import { getPeriodRange, type Period } from "@/lib/date/periods";
import { TransactionSheet } from "@/components/transactions/TransactionSheet";
import { SpendingChart } from "@/components/SpendingChart";
import { useDueRecurring } from "@/features/transactions/hooks/useRecurringTransactions";
import { useCreateTransaction } from "@/features/transactions/hooks/useCreateTransaction";
import { todayISO } from "@/lib/date/iso";
import type { Transaction } from "@/types";

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { transactions, refresh, syncing } = useTransactions();
  // Show skeleton only when store is empty; if we already have data (from
  // local cache or a previous session) render it immediately and refresh quietly.
  const [loading, setLoading] = useState(transactions.length === 0);
  // The total-spent amount always waits for the first server confirmation so
  // stale local-cache data (which can span more rows than page 1) never flashes.
  const [amountLoading, setAmountLoading] = useState(true);
  const syncStartedRef = useRef(false);
  const [period, setPeriod] = useState<Period>("month");
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  const firstName = session?.user?.name?.split(" ")[0] ?? "there";

  useEffect(() => {
    if (!session) return;
    if ((session as { sheet_is_new?: boolean }).sheet_is_new) {
      router.replace("/onboarding");
      return;
    }
    refresh().finally(() => setLoading(false));
  }, [session, router, refresh]);

  // Reveal the total only after the sync cycle completes (true→false transition).
  // This prevents the cached-all-transactions total from briefly differing from
  // the page-1 API total.
  useEffect(() => {
    if (syncing) {
      syncStartedRef.current = true;
    } else if (syncStartedRef.current) {
      setAmountLoading(false);
    }
  }, [syncing]);

  // Offline fallback: no sync will start, so reveal the cached total immediately.
  useEffect(() => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setAmountLoading(false);
    }
  }, []);

  const { from, to } = getPeriodRange(period);
  const filtered = transactions.filter(
    (t) => t.date >= from && t.date <= to
  );
  const totalSpent = filtered.reduce((s, t) => s + t.amount, 0);
  const duplicates = filtered.filter((t) => t.is_duplicate);

  const byCategory: Record<string, number> = {};
  for (const t of filtered) {
    byCategory[t.category] = (byCategory[t.category] ?? 0) + t.amount;
  }
  const topCategories = Object.entries(byCategory).sort(([, a], [, b]) => b - a).slice(0, 3);

  const recent = [...filtered].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)).slice(0, 5);
  const dueRecurring = useDueRecurring(transactions);
  const { createTransaction } = useCreateTransaction();

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6 pb-8 flex flex-col gap-5">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <p style={{ fontSize: 22, fontWeight: 700, color: "var(--color-on-background)" }}>Hi, {firstName} 👋</p>
          <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex gap-2">
        {(["week", "month", "year"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className="px-4 py-2 rounded-full text-sm font-medium transition-all capitalize"
            style={{
              background: p === period ? "var(--color-primary)" : "var(--color-surface-container)",
              color: p === period ? "var(--color-on-primary)" : "var(--color-on-surface-variant)",
            }}
          >
            {p === "week" ? "This week" : p === "month" ? "This month" : "This year"}
          </button>
        ))}
      </div>

      {/* Total spent card */}
      <div className="rounded-3xl p-6" style={{ background: "var(--color-primary)", boxShadow: "0 8px 24px rgba(31,16,142,0.25)" }}>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>Total Spent</p>
        <p style={{ fontSize: 40, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }} className="mt-1">
          {amountLoading ? "…" : formatINR(totalSpent)}
        </p>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }} className="mt-2">
          {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}
          {period === "month" ? ` this ${new Date().toLocaleString("en-IN", { month: "long" })}` : period === "week" ? " this week" : " this year"}
        </p>

        {/* Mini category bars */}
        {topCategories.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {topCategories.map(([cat, amt]) => (
              <div key={cat} className="flex items-center gap-3">
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", width: 100, flexShrink: 0 }} className="truncate">{cat}</p>
                <div className="flex-1 h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }}>
                  <div className="h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.8)", width: `${Math.min((amt / totalSpent) * 100, 100)}%` }} />
                </div>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", fontWeight: 600, width: 64, textAlign: "right" }}>{formatINR(amt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Spending chart */}
      <SpendingChart
        transactions={filtered}
        from={from}
        to={to}
        period={period}
        totalSpent={totalSpent}
      />

      {/* Recurring due card */}
      {dueRecurring.length > 0 && (
        <div className="flex flex-col gap-2">
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }}>Recurring due</p>
          {dueRecurring.map(({ template, dueDate, overdueDays }) => (
            <div key={`${template.id}-${dueDate}`} className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border"
              style={{ borderColor: overdueDays > 0 ? "var(--color-error)" : "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate" style={{ fontSize: 14, color: "var(--color-on-surface)" }}>
                  {template.item_name || template.merchant}
                </p>
                <p style={{ fontSize: 12, color: overdueDays > 0 ? "var(--color-error)" : "var(--color-on-surface-variant)" }}>
                  {overdueDays === 0 ? "Due today" : `${overdueDays}d overdue`} · {formatINR(template.amount)}
                </p>
              </div>
              <button
                onClick={() => {
                  const now = new Date().toISOString();
                  createTransaction({
                    ...template,
                    id: crypto.randomUUID(),
                    date: todayISO(),
                    time: new Date().toTimeString().slice(0, 5),
                    created_at: now,
                    updated_at: now,
                    status: "done",
                  });
                }}
                className="px-3 py-1.5 rounded-xl font-medium text-sm flex-shrink-0"
                style={{ background: "var(--color-primary)", color: "var(--color-on-primary)" }}>
                Log it
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Duplicate alert */}
      {duplicates.length > 0 && (
        <Link href="/transactions?duplicates_only=true" className="rounded-2xl p-4 flex items-center gap-3" style={{ background: "#fff3e0", border: "1px solid #ffe0b2" }}>
          <span className="material-symbols-outlined" style={{ color: "#e65100", fontVariationSettings: "'FILL' 1" }}>warning</span>
          <p style={{ fontSize: 14, color: "#bf360c", fontWeight: 500 }}>
            {duplicates.length} possible duplicate{duplicates.length > 1 ? "s" : ""} — tap to review
          </p>
          <span className="material-symbols-outlined ml-auto" style={{ color: "#e65100", fontSize: 18 }}>chevron_right</span>
        </Link>
      )}

      {/* Quick add (desktop) */}
      <div className="hidden md:flex gap-3">
        <Link href="/add" className="flex-1 flex items-center gap-2 p-4 rounded-2xl font-medium transition-colors" style={{ background: "var(--color-primary)", color: "#fff" }}>
          <span className="material-symbols-outlined">edit_note</span> Add manually
        </Link>
        <Link href="/capture?tab=paste" className="flex-1 flex items-center gap-2 p-4 rounded-2xl font-medium transition-colors" style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)" }}>
          <span className="material-symbols-outlined">content_paste</span> Paste SMS
        </Link>
        <Link href="/capture?tab=camera" className="flex-1 flex items-center gap-2 p-4 rounded-2xl font-medium transition-colors" style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)" }}>
          <span className="material-symbols-outlined">photo_camera</span> Receipt
        </Link>
      </div>

      {/* Recent transactions */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <p style={{ fontSize: 16, fontWeight: 600, color: "var(--color-on-background)" }}>Recent</p>
          <Link href="/transactions" style={{ fontSize: 14, color: "var(--color-primary)", fontWeight: 500 }}>See all</Link>
        </div>

        {loading && transactions.length === 0 ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: "var(--color-surface-container)" }} />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-4" style={{ color: "var(--color-on-surface-variant)" }}>
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl" style={{ background: "var(--color-surface-container)" }}>🧾</div>
            <p style={{ fontSize: 16, fontWeight: 600, color: "var(--color-on-surface)" }}>No transactions yet</p>
            <p style={{ fontSize: 14 }}>Tap + to add your first expense</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {recent.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} onClick={() => setSelectedTx(tx)} />
            ))}
          </div>
        )}
      </div>

      {/* Analysis CTA */}
      {filtered.length >= 5 && (
        <Link
          href="/analysis"
          className="rounded-2xl p-4 flex items-center gap-4"
          style={{ background: "var(--color-primary-fixed)", border: "1px solid var(--color-primary-fixed-dim)" }}
        >
          <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 28, fontVariationSettings: "'FILL' 1" }}>psychology</span>
          <div>
            <p style={{ fontWeight: 600, color: "var(--color-primary)" }}>Get AI insights</p>
            <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>See where you can save money this month</p>
          </div>
          <span className="material-symbols-outlined ml-auto" style={{ color: "var(--color-primary)", fontSize: 20 }}>chevron_right</span>
        </Link>
      )}

      {selectedTx && (
        <TransactionSheet tx={selectedTx} onClose={() => setSelectedTx(null)} />
      )}
    </div>
  );
}

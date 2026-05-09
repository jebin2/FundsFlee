"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Transaction } from "@/types";
import { useProfile } from "@/hooks/useProfile";
import { TransactionRow, formatINR, categoryIcons } from "@/components/TransactionRow";

type Period = "week" | "month" | "year";

function getDateRange(period: Period): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().split("T")[0];
  let from: Date;
  if (period === "week") {
    from = new Date(now); from.setDate(now.getDate() - 7);
  } else if (period === "month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    from = new Date(now.getFullYear(), 0, 1);
  }
  return { from: from.toISOString().split("T")[0], to };
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const { profile } = useProfile();
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("month");

  const firstName = session?.user?.name?.split(" ")[0] ?? "there";

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/transactions");
      const data = await res.json();
      setTransactions(data.transactions ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    if ((session as { sheet_is_new?: boolean }).sheet_is_new) {
      router.replace("/onboarding");
      return;
    }
    loadData();
  }, [session, loadData, router]);

  const { from, to } = getDateRange(period);
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

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6 pb-8 flex flex-col gap-5">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <p style={{ fontSize: 22, fontWeight: 700, color: "var(--color-on-background)" }}>Hi, {firstName} 👋</p>
          <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <Link href="/add" className="w-10 h-10 rounded-full flex items-center justify-center md:hidden" style={{ background: "var(--color-primary)", color: "#fff" }}>
          <span className="material-symbols-outlined">add</span>
        </Link>
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
          {loading ? "…" : formatINR(totalSpent)}
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

        {loading ? (
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
              <TransactionRow key={tx.id} tx={tx} subtitleMode="category-date" />
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
    </div>
  );
}

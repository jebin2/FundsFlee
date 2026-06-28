"use client";

import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import type { Transaction } from "@/types";
import { formatINR } from "@/lib/format/currency";
import type { Period } from "@/lib/date/periods";
import { toISODate } from "@/lib/date/iso";

interface SpendingChartProps {
  transactions: Transaction[];
  from: string;
  to: string;
  period: Period;
  totalSpent: number;
}

const CAT_COLORS: Record<string, string> = {
  "Food & Dining":     "#FF6B6B",
  "Transport":         "#4ECDC4",
  "Shopping":          "#45B7D1",
  "Entertainment":     "#96CEB4",
  "Health":            "#FFEAA7",
  "Bills & Utilities": "#DDA0DD",
  "Education":         "#98D8C8",
  "Personal Care":     "#F7DC6F",
  "Gifts & Donations": "#BB8FCE",
  "Others":            "#AED6F1",
};
const DEFAULT_COLOR = "#CBD5E1";

function dateLabel(date: string, period: Period): string {
  const d = new Date(date + "T00:00:00");
  if (period === "year") return d.toLocaleString("en-IN", { month: "short" });
  if (period === "week") return d.toLocaleString("en-IN", { weekday: "short" });
  return String(d.getDate());
}

function buildTrendData(transactions: Transaction[], from: string, to: string, period: Period) {
  const buckets: Record<string, number> = {};

  if (period === "year") {
    // Monthly buckets
    for (let m = 0; m < 12; m++) {
      const key = `${new Date(from).getFullYear()}-${String(m + 1).padStart(2, "0")}`;
      buckets[key] = 0;
    }
    for (const tx of transactions) {
      const key = tx.date.slice(0, 7);
      if (key in buckets) buckets[key] = (buckets[key] ?? 0) + tx.amount;
    }
    return Object.entries(buckets).map(([key, amount]) => ({
      label: new Date(key + "-01T00:00:00").toLocaleString("en-IN", { month: "short" }),
      amount: Math.round(amount),
    }));
  }

  // Daily buckets for week and month
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = toISODate(d);
    buckets[key] = 0;
  }
  for (const tx of transactions) {
    if (tx.date in buckets) buckets[tx.date] = (buckets[tx.date] ?? 0) + tx.amount;
  }

  const entries = Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b));

  // For month: group into weeks to avoid 30 cramped bars
  if (period === "month" && entries.length > 14) {
    const weeks: { label: string; amount: number }[] = [];
    for (let i = 0; i < entries.length; i += 7) {
      const slice = entries.slice(i, i + 7);
      const total = slice.reduce((s, [, v]) => s + v, 0);
      const weekStart = new Date(slice[0][0] + "T00:00:00");
      weeks.push({ label: `${weekStart.getDate()} ${weekStart.toLocaleString("en-IN", { month: "short" })}`, amount: Math.round(total) });
    }
    return weeks;
  }

  return entries.map(([date, amount]) => ({
    label: dateLabel(date, period),
    amount: Math.round(amount),
  }));
}

function buildCategoryData(transactions: Transaction[]) {
  const totals: Record<string, number> = {};
  for (const tx of transactions) {
    totals[tx.category] = (totals[tx.category] ?? 0) + tx.amount;
  }
  return Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .map(([name, value]) => ({ name, value: Math.round(value) }));
}

function INRTooltip({ active, payload }: { active?: boolean; payload?: { value: number }[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-1.5 rounded-xl text-sm font-semibold"
      style={{ background: "var(--color-surface)", border: "1px solid var(--color-outline-variant)", color: "var(--color-on-surface)" }}>
      {formatINR(payload[0].value)}
    </div>
  );
}

export function SpendingChart({ transactions, from, to, period, totalSpent }: SpendingChartProps) {
  const [view, setView] = useState<"trend" | "category">("trend");

  const trendData  = useMemo(() => buildTrendData(transactions, from, to, period), [transactions, from, to, period]);
  const catData    = useMemo(() => buildCategoryData(transactions), [transactions]);

  if (transactions.length < 3) return null;

  const barColor = "var(--color-primary)";

  return (
    <div className="rounded-3xl p-4 flex flex-col gap-3"
      style={{ background: "var(--color-surface-container-lowest)", border: "1px solid var(--color-outline-variant)" }}>

      {/* Tab switcher */}
      <div className="flex gap-2">
        {(["trend", "category"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className="px-4 py-1.5 rounded-full text-sm font-medium capitalize"
            style={{
              background: view === v ? "var(--color-primary)" : "var(--color-surface-container)",
              color: view === v ? "var(--color-on-primary)" : "var(--color-on-surface-variant)",
            }}>
            {v === "trend" ? "Trend" : "By Category"}
          </button>
        ))}
      </div>

      {/* Charts */}
      {view === "trend" ? (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={trendData} barCategoryGap="30%">
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--color-on-surface-variant)" }} axisLine={false} tickLine={false} />
            <Tooltip content={<INRTooltip />} cursor={{ fill: "var(--color-surface-container)" }} />
            <Bar dataKey="amount" fill={barColor} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex gap-4 items-center">
          <ResponsiveContainer width={140} height={140}>
            <PieChart>
              <Pie data={catData} cx="50%" cy="50%" innerRadius={40} outerRadius={65}
                dataKey="value" strokeWidth={0}>
                {catData.map((entry, i) => (
                  <Cell key={i} fill={CAT_COLORS[entry.name] ?? DEFAULT_COLOR} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 flex flex-col gap-1.5 overflow-hidden">
            {catData.slice(0, 5).map((entry) => (
              <div key={entry.name} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: CAT_COLORS[entry.name] ?? DEFAULT_COLOR }} />
                <span className="truncate" style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>{entry.name}</span>
                <span className="ml-auto flex-shrink-0" style={{ fontSize: 12, fontWeight: 600, color: "var(--color-on-surface)" }}>
                  {totalSpent > 0 ? `${Math.round((entry.value / totalSpent) * 100)}%` : "0%"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

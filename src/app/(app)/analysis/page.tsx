"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { InsightsTab } from "@/components/analysis/InsightsTab";
import { CompareTab } from "@/components/analysis/CompareTab";

// ── Shared ────────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { label: "This month", value: "month" },
  { label: "Last 7 days", value: "week" },
  { label: "This year", value: "year" },
];

type MainTab = "insights" | "compare";

// ── Page ──────────────────────────────────────────────────────────────────────

function AnalysisContent() {
  const searchParams = useSearchParams();
  const [mainTab, setMainTab] = useState<MainTab>(
    searchParams.get("tab") === "compare" ? "compare" : "insights"
  );
  const [period, setPeriod] = useState("month");

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6 pb-8 flex flex-col gap-5">
      {/* Main tabs */}
      <div className="flex gap-1 p-1 rounded-2xl" style={{ background: "var(--color-surface-container)" }}>
        {([ { value: "insights", label: "Insights", icon: "analytics" }, { value: "compare", label: "Compare", icon: "compare_arrows" }] as { value: MainTab; label: string; icon: string }[]).map(({ value, label, icon }) => (
          <button key={value} onClick={() => setMainTab(value)}
            className="flex-1 py-2.5 rounded-xl flex items-center justify-center gap-1.5 font-semibold transition-all"
            style={{
              background: mainTab === value ? "var(--color-primary)" : "transparent",
              color: mainTab === value ? "#fff" : "var(--color-on-surface-variant)",
              fontSize: 14,
            }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: mainTab === value ? "'FILL' 1" : "'FILL' 0" }}>{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* Period selector */}
      <div className="flex gap-2">
        {PERIOD_OPTIONS.map(({ label, value }) => (
          <button key={value} onClick={() => setPeriod(value)}
            className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: period === value ? "var(--color-secondary-container)" : "var(--color-surface-container)",
              color: period === value ? "var(--color-on-secondary-container)" : "var(--color-on-surface-variant)",
            }}>
            {label}
          </button>
        ))}
      </div>

      {mainTab === "insights" ? <InsightsTab period={period} /> : <CompareTab period={period} />}
    </div>
  );
}

export default function AnalysisPage() {
  return <Suspense><AnalysisContent /></Suspense>;
}

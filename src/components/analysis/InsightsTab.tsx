"use client";

import { useState, useEffect, useCallback } from "react";
import type { AnalysisResult } from "@/types";
import { useProfile } from "@/hooks/useProfile";
import { usePoller } from "@/hooks/usePoller";
import { Spinner, GeneratingSpinner, FailedState } from "./AnalysisStates";
import type { AsyncStatus } from "./AnalysisStates";
import { formatINR } from "@/lib/format/currency";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export function InsightsTab({ period }: { period: string }) {
  const { profile } = useProfile();
  const isOnline = useOnlineStatus();
  const [status, setStatus] = useState<AsyncStatus>("loading");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [generatedAt, setGeneratedAt] = useState("");

  const check = useCallback(async (): Promise<AsyncStatus> => {
    try {
      const res = await fetch(`/api/analyze?period=${period}`);
      const data = await res.json();
      if (data.status === "done") {
        setAnalysis(data.analysis);
        setGeneratedAt(data.generated_at ?? "");
      }
      setStatus(data.status);
      return data.status;
    } catch {
      setStatus("not_started");
      return "not_started";
    }
  }, [period]);

  useEffect(() => {
    void (async () => {
      setStatus("loading");
      setAnalysis(null);
      await check();
    })();
  }, [check]);

  usePoller(check, status === "generating");

  async function request(forceRefresh = false) {
    setStatus("generating");
    setAnalysis(null);
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period,
        region: profile.region || localStorage.getItem("region") || "",
        lifestyle_tags: profile.lifestyle_tags,
        force_refresh: forceRefresh,
      }),
    });
    const data = await res.json();
    if (data.status === "done") {
      setAnalysis(data.analysis);
      setGeneratedAt(data.generated_at ?? "");
      setStatus("done");
    } else {
      setStatus(data.status ?? "failed");
    }
  }

  if (status === "loading") return <Spinner />;

  if (!isOnline && status === "not_started") return (
    <div className="flex flex-col items-center py-16 gap-4 text-center px-4">
      <span className="material-symbols-outlined" style={{ fontSize: 48, color: "var(--color-outline)" }}>wifi_off</span>
      <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-on-surface)" }}>Not available offline</p>
      <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)", maxWidth: 260 }}>Connect to the internet to generate AI insights.</p>
    </div>
  );

  if (status === "not_started") return (
    <div className="flex flex-col items-center py-12 gap-6 text-center">
      <div className="w-28 h-28 rounded-3xl flex items-center justify-center relative" style={{ background: "var(--color-primary-fixed)" }}>
        <span style={{ fontSize: 56 }}>📊</span>
        <div className="absolute -top-2 -right-2 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "var(--color-primary)" }}>
          <span className="material-symbols-outlined" style={{ color: "#fff", fontSize: 18, fontVariationSettings: "'FILL' 1" }}>psychology</span>
        </div>
      </div>
      <div>
        <p style={{ fontSize: 20, fontWeight: 700, color: "var(--color-on-surface)" }} className="mb-2">AI-powered insights</p>
        <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)", maxWidth: 280 }}>Region-aware spending analysis and personalised savings tips.</p>
      </div>
      <button onClick={() => request()} className="px-8 py-4 rounded-2xl font-semibold flex items-center gap-2"
        style={{ background: "var(--color-primary)", color: "#fff", fontSize: 16, boxShadow: "0 8px 20px rgba(31,16,142,0.25)" }}>
        <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
        Generate Analysis
      </button>
    </div>
  );

  if (status === "generating") return <GeneratingSpinner label="Analyzing your spending…" />;

  if (status === "failed") return (
    <FailedState onRetry={() => request(true)} />
  );

  if (!analysis) return null;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-3xl p-6" style={{ background: "var(--color-primary)", boxShadow: "0 8px 24px rgba(31,16,142,0.25)" }}>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>Total Spent</p>
        <p style={{ fontSize: 40, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>{formatINR(analysis.total_spent)}</p>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }} className="mt-1">{analysis.period}</p>
      </div>

      <div>
        <p style={{ fontSize: 16, fontWeight: 600, color: "var(--color-on-background)" }} className="mb-3">Spending by category</p>
        <div className="rounded-2xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
          {analysis.by_category.map((cat, i, arr) => (
            <div key={cat.category} className="px-4 py-3" style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--color-surface-variant)" : "none" }}>
              <div className="flex justify-between items-center mb-1.5">
                <p style={{ fontSize: 14, fontWeight: 500 }}>{cat.category}</p>
                <p style={{ fontSize: 14, fontWeight: 600 }}>{formatINR(cat.amount)}</p>
              </div>
              <div className="h-2 rounded-full" style={{ background: "var(--color-surface-container)" }}>
                <div className="h-2 rounded-full" style={{ background: "var(--color-primary)", width: `${cat.percent}%` }} />
              </div>
              <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }} className="mt-1">{cat.percent}% · {cat.count} transactions</p>
            </div>
          ))}
        </div>
      </div>

      {analysis.ai_insights.length > 0 && (
        <div>
          <p style={{ fontSize: 16, fontWeight: 600 }} className="mb-3">What the AI noticed</p>
          <div className="flex flex-col gap-3">
            {analysis.ai_insights.map((insight, i) => (
              <div key={i} className="flex gap-3 p-4 rounded-2xl" style={{ background: "var(--color-surface-container-lowest)", border: "1px solid var(--color-surface-variant)" }}>
                <span className="material-symbols-outlined flex-shrink-0 mt-0.5" style={{ color: "var(--color-primary)", fontSize: 20, fontVariationSettings: "'FILL' 1" }}>lightbulb</span>
                <p style={{ fontSize: 14, lineHeight: 1.6 }}>{insight}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {analysis.optimization_tips.length > 0 && (
        <div>
          <p style={{ fontSize: 16, fontWeight: 600 }} className="mb-3">How to save money</p>
          <div className="flex flex-col gap-3">
            {analysis.optimization_tips.map((tip, i) => (
              <div key={i} className="p-4 rounded-2xl border" style={{ background: "var(--color-surface-container-lowest)", borderColor: "var(--color-outline-variant)" }}>
                <div className="flex justify-between items-start mb-2">
                  <p style={{ fontSize: 15, fontWeight: 600, flex: 1, marginRight: 12 }}>{tip.title}</p>
                  <span className="flex-shrink-0 px-2.5 py-1 rounded-full font-semibold" style={{ background: "var(--color-success-container)", color: "var(--color-success)", fontSize: 13 }}>
                    Save {formatINR(tip.potential_saving)}/mo
                  </span>
                </div>
                <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)", lineHeight: 1.6 }}>{tip.description}</p>
                <div className="flex gap-2 mt-3">
                  <span className="px-2 py-1 rounded-lg text-xs font-medium" style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)" }}>Effort: {tip.effort}</span>
                  <span className="px-2 py-1 rounded-lg text-xs font-medium" style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)" }}>Quality: {tip.quality_impact} impact</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        {generatedAt && <p style={{ fontSize: 12, color: "var(--color-outline)" }}>Generated · {new Date(generatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}
        <button onClick={() => request(true)} className="ml-auto flex items-center gap-2 py-2 px-4 rounded-xl font-medium"
          style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", fontSize: 14 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>Refresh
        </button>
      </div>
    </div>
  );
}

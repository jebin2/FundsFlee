"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { AnalysisResult, Transaction } from "@/types";
import type { CompareResult } from "@/lib/ai/compare";
import { useProfile } from "@/hooks/useProfile";

function formatINR(n: number) {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// ── Shared ────────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { label: "This month", value: "month" },
  { label: "Last 7 days", value: "week" },
  { label: "This year", value: "year" },
];

type AsyncStatus = "loading" | "not_started" | "generating" | "done" | "failed";

function usePoller(
  checkFn: () => Promise<AsyncStatus>,
  active: boolean
) {
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { if (ref.current) { clearInterval(ref.current); ref.current = null; } };

  useEffect(() => {
    if (!active) { stop(); return; }
    ref.current = setInterval(async () => {
      const s = await checkFn();
      if (s !== "generating") stop();
    }, 5000);
    return stop;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return stop;
}

// ── Insights tab ──────────────────────────────────────────────────────────────

function InsightsTab({ period }: { period: string }) {
  const { profile } = useProfile();
  const [status, setStatus] = useState<AsyncStatus>("loading");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [generatedAt, setGeneratedAt] = useState("");

  const check = useCallback(async (): Promise<AsyncStatus> => {
    const res = await fetch(`/api/analyze?period=${period}`);
    const data = await res.json();
    if (data.status === "done") {
      setAnalysis(data.analysis);
      setGeneratedAt(data.generated_at ?? "");
    }
    setStatus(data.status);
    return data.status;
  }, [period]);

  useEffect(() => {
    setStatus("loading");
    setAnalysis(null);
    check();
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

// ── Compare tab ───────────────────────────────────────────────────────────────

function CompareTab({ period }: { period: string }) {
  const { profile } = useProfile();
  const [merchants, setMerchants] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AsyncStatus>("not_started");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [generatedAt, setGeneratedAt] = useState("");
  const [txLoading, setTxLoading] = useState(true);

  // Load distinct merchants
  useEffect(() => {
    setTxLoading(true);
    fetch("/api/transactions")
      .then((r) => r.json())
      .then((d) => {
        const txs: Transaction[] = (d.transactions ?? []).filter((t: Transaction) => t.amount > 0);
        const unique = [...new Set(txs.map((t) => t.merchant).filter(Boolean))].sort();
        setMerchants(unique);
      })
      .finally(() => setTxLoading(false));
  }, []);

  const checkStatus = useCallback(async (): Promise<AsyncStatus> => {
    if (selected.length < 2) return "not_started";
    const params = new URLSearchParams({ merchants: selected.join("|"), period });
    const res = await fetch(`/api/compare?${params}`);
    const data = await res.json();
    if (data.status === "done") {
      setResult(data.result);
      setGeneratedAt(data.generated_at ?? "");
    }
    setStatus(data.status);
    return data.status;
  }, [selected, period]);

  usePoller(checkStatus, status === "generating");

  // Check cache when selection changes
  useEffect(() => {
    if (selected.length < 2) { setStatus("not_started"); setResult(null); return; }
    setStatus("loading");
    checkStatus();
  }, [selected, period, checkStatus]);

  async function runCompare(forceRefresh = false) {
    if (selected.length < 2) return;
    setStatus("generating");
    setResult(null);
    const res = await fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchants: selected,
        period,
        region: profile.region || localStorage.getItem("region") || "",
        force_refresh: forceRefresh,
      }),
    });
    const data = await res.json();
    if (data.status === "done") { setResult(data.result); setGeneratedAt(data.generated_at ?? ""); setStatus("done"); }
    else setStatus(data.status ?? "failed");
  }

  function toggle(m: string) {
    setSelected((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : prev.length >= 4 ? prev : [...prev, m]
    );
  }

  const filtered = merchants.filter((m) => m.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
      {/* Merchant picker */}
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
        <div className="px-4 pt-4 pb-2">
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }} className="mb-2">
            Pick 2–4 merchants to compare
          </p>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search merchants…"
            className="w-full px-3 py-2 rounded-xl border outline-none text-sm"
            style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface)", color: "var(--color-on-surface)" }}
          />
        </div>

        {txLoading ? (
          <div className="px-4 py-6 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
          </div>
        ) : (
          <div className="max-h-52 overflow-y-auto px-2 py-2 flex flex-col gap-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm" style={{ color: "var(--color-outline)" }}>No merchants found</p>
            ) : filtered.map((m) => {
              const isSelected = selected.includes(m);
              const isDisabled = !isSelected && selected.length >= 4;
              return (
                <button
                  key={m}
                  onClick={() => !isDisabled && toggle(m)}
                  disabled={isDisabled}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left w-full transition-all"
                  style={{
                    background: isSelected ? "var(--color-primary-fixed)" : "transparent",
                    opacity: isDisabled ? 0.4 : 1,
                  }}
                >
                  <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all"
                    style={{ borderColor: isSelected ? "var(--color-primary)" : "var(--color-outline-variant)", background: isSelected ? "var(--color-primary)" : "transparent" }}>
                    {isSelected && <span className="material-symbols-outlined text-white" style={{ fontSize: 14 }}>check</span>}
                  </div>
                  <span style={{ fontSize: 14, color: "var(--color-on-surface)", fontWeight: isSelected ? 600 : 400 }}>{m}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((m) => (
            <div key={m} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
              style={{ background: "var(--color-primary)", color: "#fff" }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{m}</span>
              <button onClick={() => toggle(m)}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Action / result */}
      {selected.length < 2 ? (
        <p className="text-center py-6" style={{ fontSize: 14, color: "var(--color-outline)" }}>
          Select at least 2 merchants to compare
        </p>
      ) : status === "loading" ? (
        <Spinner />
      ) : status === "generating" ? (
        <GeneratingSpinner label={`Comparing ${selected.join(" vs ")}…`} />
      ) : status === "failed" ? (
        <FailedState onRetry={() => runCompare(true)} />
      ) : status === "not_started" || !result ? (
        <button
          onClick={() => runCompare()}
          className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
          style={{ background: "var(--color-primary)", color: "#fff", fontSize: 16, boxShadow: "0 8px 20px rgba(31,16,142,0.25)" }}
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>compare_arrows</span>
          Compare with AI
        </button>
      ) : (
        <CompareResultView result={result} generatedAt={generatedAt} onRefresh={() => runCompare(true)} />
      )}
    </div>
  );
}

// ── Compare result ────────────────────────────────────────────────────────────

function CompareResultView({ result, generatedAt, onRefresh }: { result: CompareResult; generatedAt: string; onRefresh: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Verdict banner */}
      <div className="rounded-3xl p-5" style={{ background: "var(--color-primary)", boxShadow: "0 8px 24px rgba(31,16,142,0.2)" }}>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>AI Verdict</p>
        <p style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginTop: 4 }}>{result.verdict}</p>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.85)", marginTop: 8, lineHeight: 1.6 }}>{result.summary}</p>
      </div>

      {/* Aspect scorecards */}
      {result.aspects.map((aspect) => {
        const merchants = Object.keys(aspect.scores);
        const maxScore = Math.max(...Object.values(aspect.scores));
        return (
          <div key={aspect.aspect} className="rounded-2xl border overflow-hidden"
            style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
            <div className="px-4 py-3 border-b flex items-center justify-between"
              style={{ borderColor: "var(--color-surface-variant)" }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }}>{aspect.aspect}</p>
              {aspect.winner && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                  style={{ background: "var(--color-success-container)", color: "var(--color-success)" }}>
                  {aspect.winner} wins
                </span>
              )}
            </div>
            <div className="px-4 py-3 flex flex-col gap-2">
              <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)", lineHeight: 1.6, marginBottom: 4 }}>{aspect.analysis}</p>
              {merchants.map((m) => {
                const score = aspect.scores[m] ?? 0;
                return (
                  <div key={m}>
                    <div className="flex justify-between items-center mb-1">
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-on-surface)" }}>{m}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: score === maxScore ? "var(--color-success)" : "var(--color-on-surface-variant)" }}>{score}/10</span>
                    </div>
                    <div className="h-2 rounded-full" style={{ background: "var(--color-surface-container)" }}>
                      <div className="h-2 rounded-full transition-all"
                        style={{ width: `${score * 10}%`, background: score === maxScore ? "var(--color-success)" : "var(--color-primary)" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Recommendation */}
      <div className="flex gap-3 p-4 rounded-2xl" style={{ background: "var(--color-primary-fixed)", border: "1px solid var(--color-primary-fixed-dim)" }}>
        <span className="material-symbols-outlined flex-shrink-0" style={{ color: "var(--color-primary)", fontSize: 22, fontVariationSettings: "'FILL' 1" }}>tips_and_updates</span>
        <p style={{ fontSize: 14, color: "var(--color-on-surface)", lineHeight: 1.6 }}>{result.recommendation}</p>
      </div>

      <div className="flex items-center justify-between">
        {generatedAt && <p style={{ fontSize: 12, color: "var(--color-outline)" }}>Generated · {new Date(generatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}
        <button onClick={onRefresh} className="ml-auto flex items-center gap-2 py-2 px-4 rounded-xl font-medium"
          style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", fontSize: 14 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>Refresh
        </button>
      </div>
    </div>
  );
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin"
        style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
    </div>
  );
}

function GeneratingSpinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center py-10 gap-4">
      <div className="relative w-16 h-16">
        <div className="w-16 h-16 rounded-full border-4 border-t-transparent animate-spin"
          style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
        <span className="material-symbols-outlined absolute inset-0 m-auto flex items-center justify-center"
          style={{ color: "var(--color-primary)", fontSize: 20, fontVariationSettings: "'FILL' 1", width: 20, height: 20 }}>psychology</span>
      </div>
      <p style={{ fontWeight: 600, color: "var(--color-on-surface)" }}>{label}</p>
      <div className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ background: "var(--color-surface-container)" }}>
        <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--color-primary)" }} />
        <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>Checking every 5 seconds…</p>
      </div>
    </div>
  );
}

function FailedState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center py-10 gap-4 text-center">
      <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "var(--color-error-container)" }}>
        <span className="material-symbols-outlined" style={{ color: "var(--color-error)", fontSize: 26 }}>error</span>
      </div>
      <p style={{ fontSize: 16, fontWeight: 600 }}>Analysis failed</p>
      <button onClick={onRetry} className="px-6 py-3 rounded-2xl font-semibold flex items-center gap-2"
        style={{ background: "var(--color-primary)", color: "#fff" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>Try again
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type MainTab = "insights" | "compare";

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

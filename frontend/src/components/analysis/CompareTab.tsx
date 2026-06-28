"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { CompareResult } from "@/types";
import { useProfile } from "@/hooks/useProfile";
import { usePoller } from "@/hooks/usePoller";
import { Spinner, GeneratingSpinner, FailedState } from "./AnalysisStates";
import type { AsyncStatus } from "./AnalysisStates";
import { useTransactions } from "@/hooks/useTransactions";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export function CompareTab({ period }: { period: string }) {
  const { profile } = useProfile();
  const isOnline = useOnlineStatus();
  const { transactions } = useTransactions();
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AsyncStatus>("not_started");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [generatedAt, setGeneratedAt] = useState("");

  // Derive distinct merchants from cached store — works offline
  const merchants = useMemo(
    () => [...new Set(transactions.filter((t) => t.amount > 0).map((t) => t.merchant).filter(Boolean))].sort(),
    [transactions]
  );

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
    void (async () => {
      if (selected.length < 2) { setStatus("not_started"); setResult(null); return; }
      setStatus("loading");
      await checkStatus();
    })();
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

        {(
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
        !isOnline ? (
          <div className="flex flex-col items-center py-8 gap-3 text-center">
            <span className="material-symbols-outlined" style={{ fontSize: 40, color: "var(--color-outline)" }}>wifi_off</span>
            <p style={{ fontSize: 15, color: "var(--color-on-surface-variant)" }}>Connect to compare with AI</p>
          </div>
        ) : (
          <button
            onClick={() => runCompare()}
            className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
            style={{ background: "var(--color-primary)", color: "#fff", fontSize: 16, boxShadow: "0 8px 20px rgba(31,16,142,0.25)" }}
          >
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>compare_arrows</span>
            Compare with AI
          </button>
        )
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

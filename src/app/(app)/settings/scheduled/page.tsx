"use client";

import { useEffect, useState, useCallback } from "react";
import { MobileSettingsHeader } from "@/features/settings/components/MobileSettingsHeader";
import { usePollingInterval } from "@/features/settings/hooks/usePollingInterval";

interface CronStatus {
  registered: boolean;
  email:    { lastRun: string | null; runningAt: string | null; txCount: number; enabled: boolean };
  dedup:    { lastRun: string | null; runningAt: string | null };
  analysis: {
    week:  { lastRun: string | null; status: string | null };
    month: { lastRun: string | null; status: string | null };
    year:  { lastRun: string | null; status: string | null };
  };
  schedule: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 2)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function isRecentlyRunning(runningAt: string | null): boolean {
  if (!runningAt) return false;
  return Date.now() - new Date(runningAt).getTime() < 5 * 60 * 1000;
}

function isAnalysisRunning(status: CronStatus | null): boolean {
  return ["week", "month", "year"].some(
    (p) => status?.analysis?.[p as "week" | "month" | "year"]?.status === "generating"
  );
}

export default function ScheduledSettingsPage() {
  const [status,     setStatus]     = useState<CronStatus | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [triggering, setTriggering] = useState<"all" | "email" | "dedup" | "analysis" | null>(null);
  const [cancelling, setCancelling] = useState<"email" | "dedup" | "analysis" | null>(null);
  const [lastMsg,    setLastMsg]    = useState<string | null>(null);
  const { start: startPolling, stop: stopPolling } = usePollingInterval();

  const fetchStatus = useCallback(async (): Promise<CronStatus | null> => {
    try {
      const res = await fetch("/api/cron/status");
      if (!res.ok) return null;
      const data = await res.json() as CronStatus;
      setStatus(data);
      return data;
    } catch { return null; }
  }, []);

  useEffect(() => {
    fetchStatus().then((data) => {
      setLoading(false);
      if (data && (isRecentlyRunning(data.email.runningAt) || isRecentlyRunning(data.dedup.runningAt) || isAnalysisRunning(data))) {
        startPolling(async (_, stop) => {
          const d = await fetchStatus();
          if (d && !isRecentlyRunning(d.email.runningAt) && !isRecentlyRunning(d.dedup.runningAt) && !isAnalysisRunning(d)) stop();
        }, 10_000, 36);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function trigger(job: "all" | "email" | "dedup" | "analysis") {
    if (triggering || isAnyRunning) return;
    setTriggering(job);
    setLastMsg(null);
    try {
      const res  = await fetch(`/api/cron/run?job=${job}`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setLastMsg(
          job === "email" ? "Email import started — running in background." :
          job === "dedup" ? "Duplicate check complete." :
          "Jobs complete."
        );
        const s = await fetchStatus();
        if (s && (isRecentlyRunning(s.email.runningAt) || isRecentlyRunning(s.dedup.runningAt))) {
          startPolling(async (_, stop) => {
            const d = await fetchStatus();
            if (d && !isRecentlyRunning(d.email.runningAt) && !isRecentlyRunning(d.dedup.runningAt) && !isAnalysisRunning(d)) stop();
          }, 10_000, 36);
        }
      } else {
        setLastMsg(data.error ?? "Failed.");
      }
    } catch {
      setLastMsg("Network error — please try again.");
    } finally {
      setTriggering(null);
    }
  }

  async function cancel(job: "email" | "dedup" | "analysis") {
    setCancelling(job);
    try {
      await fetch(`/api/cron/clear?job=${job}`, { method: "POST" });
      await fetchStatus();
      stopPolling();
    } catch {
      // best-effort
    } finally {
      setCancelling(null);
    }
  }

  const emailServerRunning    = isRecentlyRunning(status?.email.runningAt ?? null);
  const dedupServerRunning    = isRecentlyRunning(status?.dedup.runningAt ?? null);
  const analysisServerRunning = isAnalysisRunning(status);
  const isAnyRunning = !!triggering || emailServerRunning || dedupServerRunning || analysisServerRunning;

  const analysisLastRun = ["week", "month", "year"]
    .map((p) => status?.analysis?.[p as "week" | "month" | "year"]?.lastRun ?? null)
    .filter(Boolean).sort().at(-1) ?? null;

  const jobs = [
    {
      key:           "email" as const,
      icon:          "mark_email_read",
      label:         "Email Import",
      sub:           status?.email.enabled
                       ? `${status.email.txCount} total imported`
                       : "Disabled — configure filters in Email Import settings",
      lastRun:       status?.email.lastRun ?? null,
      serverRunning: emailServerRunning,
      enabled:       status?.email.enabled ?? false,
      color:         "var(--color-primary)",
      bg:            "var(--color-primary-fixed)",
    },
    {
      key:           "dedup" as const,
      icon:          "content_copy",
      label:         "Duplicate Detection",
      sub:           "Scans all transactions and flags duplicates",
      lastRun:       status?.dedup.lastRun ?? null,
      serverRunning: dedupServerRunning,
      enabled:       true,
      color:         "#0277bd",
      bg:            "#e1f5fe",
    },
    {
      key:           "analysis" as const,
      icon:          "analytics",
      label:         "Spending Analysis",
      sub:           "Generates insights for last 7 days, this month, and this year",
      lastRun:       analysisLastRun,
      serverRunning: analysisServerRunning,
      enabled:       true,
      color:         "#6a1b9a",
      bg:            "#f3e5f5",
    },
  ];

  return (
    <div className="max-w-lg mx-auto px-5 pb-10">
      <MobileSettingsHeader title="Scheduled Tasks" />

      <div className="flex flex-col gap-5 pt-4">
        <div className="rounded-2xl p-4 flex items-center gap-4"
          style={{ background: "var(--color-primary-fixed)", border: "1px solid var(--color-outline-variant)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 28, fontVariationSettings: "'FILL' 1" }}>schedule</span>
          <div className="flex-1">
            <p style={{ fontSize: 15, fontWeight: 700, color: "var(--color-primary)" }}>Daily at 12:00 PM IST</p>
            <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)", marginTop: 2 }}>
              Email import runs first, then duplicate check — one after the other.
            </p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className={`w-2.5 h-2.5 rounded-full ${loading ? "opacity-50 bg-gray-400" : status?.registered ? "bg-green-500" : "bg-orange-400"}`} />
            <p style={{ fontSize: 10, color: "var(--color-on-surface-variant)", textAlign: "center" }}>
              {loading ? "…" : status?.registered ? "Active" : "Not\nregistered"}
            </p>
          </div>
        </div>

        {!loading && !status?.registered && (
          <div className="rounded-2xl p-3 flex gap-3" style={{ background: "#fff8e1", border: "1px solid #ffe082" }}>
            <span className="material-symbols-outlined flex-shrink-0" style={{ color: "#f9a825", fontSize: 18, marginTop: 1 }}>warning</span>
            <p style={{ fontSize: 13, color: "#6d4c00" }}>
              Open any page in the app to register credentials for the scheduler automatically.
            </p>
          </div>
        )}

        {lastMsg && (
          <div className="rounded-2xl p-3 flex gap-3" style={{ background: "#e8f5e9", border: "1px solid #a5d6a7" }}>
            <span className="material-symbols-outlined flex-shrink-0" style={{ color: "#2e7d32", fontSize: 18 }}>check_circle</span>
            <p style={{ fontSize: 13, color: "#2e7d32", fontWeight: 500 }}>{lastMsg}</p>
          </div>
        )}

        <div className="rounded-3xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
          {jobs.map((job, i) => {
            const isRunning    = job.serverRunning || triggering === job.key || triggering === "all";
            const isCancelling = cancelling === job.key;
            const runDisabled  = !!triggering || isAnyRunning || !job.enabled;

            return (
              <div key={job.key} className="flex items-center gap-4 px-5 py-4"
                style={{ borderBottom: i < jobs.length - 1 ? "1px solid var(--color-surface-variant)" : "none" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: job.bg }}>
                  {isRunning
                    ? <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
                        style={{ borderColor: `${job.color}40`, borderTopColor: job.color }} />
                    : <span className="material-symbols-outlined" style={{ color: job.color, fontSize: 20 }}>{job.icon}</span>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p style={{ fontSize: 15, fontWeight: 500, color: "var(--color-on-surface)" }}>{job.label}</p>
                    {isRunning && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: job.bg, color: job.color }}>Running…</span>
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }} className="truncate">{job.sub}</p>
                  <p style={{ fontSize: 11, color: "var(--color-outline)", marginTop: 1 }}>
                    Last run: {relativeTime(job.lastRun)}
                  </p>
                </div>
                {isRunning ? (
                  <button
                    onClick={() => cancel(job.key as "email" | "dedup" | "analysis")}
                    disabled={isCancelling}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-medium text-sm flex-shrink-0"
                    style={{ background: "#fdecea", color: "#c62828", opacity: isCancelling ? 0.5 : 1, cursor: isCancelling ? "not-allowed" : "pointer" }}>
                    {isCancelling
                      ? <div className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin"
                          style={{ borderColor: "#c6282840", borderTopColor: "#c62828" }} />
                      : <span className="material-symbols-outlined" style={{ fontSize: 15 }}>stop_circle</span>
                    }
                    {isCancelling ? "…" : "Cancel"}
                  </button>
                ) : (
                  <button
                    onClick={() => trigger(job.key)}
                    disabled={runDisabled}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-medium text-sm flex-shrink-0"
                    style={{ background: job.enabled ? job.bg : "var(--color-surface-container)", color: job.enabled ? job.color : "var(--color-outline)", opacity: runDisabled ? 0.4 : 1, cursor: runDisabled ? "not-allowed" : "pointer" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>play_arrow</span>
                    Run
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <button
          onClick={() => trigger("all")}
          disabled={isAnyRunning}
          className="w-full py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2"
          style={{ background: "var(--color-primary)", color: "#fff", fontSize: 15, opacity: isAnyRunning ? 0.4 : 1, cursor: isAnyRunning ? "not-allowed" : "pointer" }}>
          {(triggering === "all" || isAnyRunning)
            ? <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />
            : <span className="material-symbols-outlined" style={{ fontSize: 18 }}>play_circle</span>
          }
          {isAnyRunning ? "Running…" : "Run All Jobs Now"}
        </button>
      </div>
    </div>
  );
}

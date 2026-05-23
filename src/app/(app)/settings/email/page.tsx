"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MobileSettingsHeader } from "@/features/settings/components/MobileSettingsHeader";
import { usePollingInterval } from "@/features/settings/hooks/usePollingInterval";

interface EmailStatus {
  fromContains: string[];
  daysBack: number;
  lastRun: string | null;
  totalTxImported: number;
  emailsScanned: number;
  emailsParsed: number;
  emailsSkipped: number;
  runningAt: string | null;
}

type JobState = "idle" | "running" | "done";

export default function EmailImportSettingsPage() {
  const [loading,      setLoading]      = useState(true);
  const [jobState,     setJobState]     = useState<JobState>("idle");
  const [status,       setStatus]       = useState<EmailStatus | null>(null);
  const [fromContains, setFromContains] = useState<string[]>([]);
  const [daysBack,     setDaysBack]     = useState(7);
  const [filterInput,  setFilterInput]  = useState("");
  const [error,        setError]        = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);
  const { start: startPolling } = usePollingInterval();

  const loadStatus = useCallback(async (): Promise<EmailStatus | null> => {
    try {
      const res = await fetch("/api/email/status");
      if (!res.ok) return null;
      return await res.json() as EmailStatus;
    } catch { return null; }
  }, []);

  const load = useCallback(async () => {
    const data = await loadStatus();
    if (data) {
      setStatus(data);
      setFromContains(data.fromContains);
      setDaysBack(data.daysBack);
      if (data.runningAt && Date.now() - new Date(data.runningAt).getTime() < 5 * 60 * 1000) {
        setJobState("running");
        startPolling(async (_, stop) => {
          const d = await loadStatus();
          if (!d) return;
          setStatus(d);
          if (!d.runningAt) { stop(); setJobState("done"); setTimeout(() => setJobState("idle"), 5000); }
        }, 5000, 60, () => setJobState("idle"));
      }
    }
    setLoading(false);
  }, [loadStatus, startPolling]);

  useEffect(() => { void load(); }, [load]);

  async function saveConfig(filters: string[], days: number) {
    setError("");
    try {
      const res = await fetch("/api/email/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromContains: filters, daysBack: days }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Save failed.");
      }
    } catch {
      setError("Network error — please try again.");
    }
  }

  function addFilter() {
    const val = filterInput.trim().toLowerCase();
    if (!val || fromContains.includes(val)) { setFilterInput(""); return; }
    const next = [...fromContains, val];
    setFromContains(next);
    setFilterInput("");
    filterInputRef.current?.focus();
    void saveConfig(next, daysBack);
  }

  function removeFilter(f: string) {
    const next = fromContains.filter((x) => x !== f);
    setFromContains(next);
    void saveConfig(next, daysBack);
  }

  async function fetchNow() {
    if (fromContains.length === 0) { setError("Add at least one sender filter first."); return; }
    setError("");
    setJobState("running");
    try {
      await saveConfig(fromContains, daysBack);
      const res = await fetch("/api/email/fetch?manual=1", { method: "POST" });
      if (!res.ok) { setJobState("idle"); setError("Could not start fetch — please try again."); return; }
      startPolling(async (_, stop) => {
        const d = await loadStatus();
        if (!d) return;
        setStatus(d);
        if (!d.runningAt) { stop(); setJobState("done"); setTimeout(() => setJobState("idle"), 5000); }
      }, 5000, 60, () => setJobState("idle"));
    } catch {
      setJobState("idle");
      setError("Network error — could not start fetch.");
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("en-IN", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  const isActive = fromContains.length > 0;

  return (
    <div className="max-w-lg mx-auto px-5 pb-24">
      <MobileSettingsHeader title="Email Import" />

      {loading ? (
        <div className="flex justify-center pt-16">
          <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin"
            style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
        </div>
      ) : (
        <div className="flex flex-col gap-6 pt-4">
          <div className="rounded-3xl p-5 flex items-center gap-4"
            style={{
              background: isActive ? "var(--color-primary)" : "var(--color-surface-container-lowest)",
              boxShadow: isActive ? "0 6px 20px rgba(31,16,142,0.2)" : "none",
              border: isActive ? "none" : "1px solid var(--color-outline-variant)",
            }}>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: isActive ? "rgba(255,255,255,0.2)" : "var(--color-surface-container)" }}>
              <span className="material-symbols-outlined"
                style={{ color: isActive ? "#fff" : "var(--color-on-surface-variant)", fontSize: 24, fontVariationSettings: "'FILL' 1" }}>
                {isActive ? "mark_email_read" : "mail"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ fontWeight: 700, fontSize: 16, color: isActive ? "#fff" : "var(--color-on-surface)" }}>
                {isActive ? "Auto-import active" : "Not configured"}
              </p>
              <p style={{ fontSize: 13, color: isActive ? "rgba(255,255,255,0.75)" : "var(--color-on-surface-variant)", marginTop: 2 }}>
                {isActive
                  ? status?.lastRun
                    ? `Last run ${formatDate(status.lastRun)} · ${status.totalTxImported} imported total`
                    : `${fromContains.length} sender${fromContains.length !== 1 ? "s" : ""} · never run yet`
                  : "Add sender filters below to start"}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p style={{ fontSize: 15, fontWeight: 600, color: "var(--color-on-surface)" }}>Sender filters</p>
            <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)", lineHeight: 1.5 }}>
              Emails from these senders are scanned for transactions. Changes save automatically.
            </p>
            <div className="rounded-2xl border p-4 flex flex-col gap-3 mt-1"
              style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
              {fromContains.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {fromContains.map((f) => (
                    <span key={f} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium"
                      style={{ background: "var(--color-primary-fixed)", color: "var(--color-primary)" }}>
                      {f}
                      <button onClick={() => removeFilter(f)} style={{ lineHeight: 1, display: "flex" }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  ref={filterInputRef}
                  type="text"
                  value={filterInput}
                  onChange={(e) => setFilterInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addFilter()}
                  placeholder="e.g. hdfcbank, noreply@phonepe.com"
                  className="flex-1 px-3 py-2.5 rounded-xl outline-none text-sm"
                  style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", border: "1px solid var(--color-outline-variant)" }}
                />
                <button onClick={addFilter} disabled={!filterInput.trim()}
                  className="px-4 py-2.5 rounded-xl font-medium text-sm flex items-center gap-1"
                  style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", opacity: filterInput.trim() ? 1 : 0.4 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
                  Add
                </button>
              </div>
              <p style={{ fontSize: 12, color: "var(--color-outline)" }}>
                Partial match — "hdfcbank" matches any sender whose address contains that text.
              </p>
            </div>
          </div>

          {error && (
            <p className="px-4 py-3 rounded-2xl text-sm"
              style={{ background: "var(--color-error-container)", color: "var(--color-on-error-container)" }}>
              {error}
            </p>
          )}

          <div className="flex flex-col gap-3">
            <p style={{ fontSize: 15, fontWeight: 600, color: "var(--color-on-surface)" }}>Manual fetch</p>

            {jobState === "running" && (
              <div className="rounded-2xl p-4 flex items-center gap-3"
                style={{ background: "var(--color-primary-fixed)", border: "1px solid var(--color-primary-fixed-dim)" }}>
                <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0"
                  style={{ borderColor: "var(--color-primary-fixed-dim)", borderTopColor: "var(--color-primary)" }} />
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }}>Scanning emails…</p>
                  <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)", marginTop: 1 }}>
                    Running in background. Stats update when done.
                  </p>
                </div>
              </div>
            )}

            {jobState === "done" && (
              <div className="rounded-2xl p-4 flex items-center gap-3"
                style={{ background: "var(--color-primary-fixed)", border: "1px solid var(--color-primary-fixed-dim)" }}>
                <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 22, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }}>Fetch complete</p>
                  {status?.lastRun && (
                    <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)", marginTop: 1 }}>
                      {status.emailsScanned} scanned · {status.emailsParsed} imported · {status.emailsSkipped} skipped
                    </p>
                  )}
                </div>
              </div>
            )}

            {jobState === "idle" && status?.lastRun && (
              <div className="rounded-2xl p-4"
                style={{ background: "var(--color-surface-container-lowest)", border: "1px solid var(--color-outline-variant)" }}>
                <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Last run</p>
                <p style={{ fontSize: 13, color: "var(--color-on-surface)", fontWeight: 500, marginTop: 4 }}>{formatDate(status.lastRun)}</p>
                <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)", marginTop: 4 }}>
                  {status.emailsScanned} scanned &nbsp;·&nbsp; {status.emailsParsed} imported &nbsp;·&nbsp; {status.emailsSkipped} skipped
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-4 py-3 rounded-2xl flex-1"
                style={{ background: "var(--color-surface-container-lowest)", border: "1px solid var(--color-outline-variant)" }}>
                <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)", flex: 1 }}>Search last</p>
                <input
                  type="number" min={1} max={365} value={daysBack}
                  onChange={(e) => setDaysBack(Math.max(1, parseInt(e.target.value) || 7))}
                  onBlur={() => void saveConfig(fromContains, daysBack)}
                  className="w-14 px-2 py-1 rounded-lg text-center font-semibold outline-none"
                  style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", fontSize: 15, border: "1px solid var(--color-outline-variant)" }}
                />
                <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>days</p>
              </div>
              <button
                onClick={fetchNow}
                disabled={jobState !== "idle" || fromContains.length === 0}
                className="px-5 py-3 rounded-2xl font-semibold flex items-center gap-2 flex-shrink-0"
                style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 14, opacity: (jobState !== "idle" || fromContains.length === 0) ? 0.4 : 1 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  {jobState === "running" ? "hourglass_empty" : "download"}
                </span>
                Fetch now
              </button>
            </div>

            <p style={{ fontSize: 12, color: "var(--color-outline)", lineHeight: 1.5 }}>
              Auto-import also runs once daily when you open the app. Only email text is read — no attachments.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

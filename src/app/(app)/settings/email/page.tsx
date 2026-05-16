"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [jobState, setJobState] = useState<JobState>("idle");
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [fromContains, setFromContains] = useState<string[]>([]);
  const [daysBack, setDaysBack] = useState(7);
  const [filterInput, setFilterInput] = useState("");
  const [error, setError] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  const loadStatus = useCallback(async (): Promise<EmailStatus | null> => {
    try {
      const res = await fetch("/api/email/status");
      if (!res.ok) return null;
      return await res.json() as EmailStatus;
    } catch {
      return null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollCountRef.current = 0;

    pollTimerRef.current = setInterval(async () => {
      pollCountRef.current++;
      // Give up after 60 polls × 5 s = 5 minutes
      if (pollCountRef.current > 60) {
        stopPolling();
        setJobState("idle");
        return;
      }

      const data = await loadStatus();
      if (!data) return;
      setStatus(data);

      // Job finished when runningAt is cleared in the sheet
      if (!data.runningAt) {
        stopPolling();
        setJobState("done");
        setTimeout(() => setJobState("idle"), 6000);
      }
    }, 5000);
  }, [loadStatus]);

  const load = useCallback(async () => {
    const data = await loadStatus();
    if (data) {
      setStatus(data);
      setFromContains(data.fromContains);
      setDaysBack(data.daysBack);

      // Resume polling if job is still running in the sheet (works across
      // page refreshes, private windows, and other devices)
      if (data.runningAt) {
        const ageMs = Date.now() - new Date(data.runningAt).getTime();
        if (ageMs < 5 * 60 * 1000) {
          setJobState("running");
          startPolling();
        }
      }
    }
    setLoading(false);
  }, [loadStatus, startPolling]);

  useEffect(() => { void load(); }, [load]);

  // Cleanup polling on unmount
  useEffect(() => () => stopPolling(), []);

  function addFilter() {
    const val = filterInput.trim().toLowerCase();
    if (!val) return;
    if (fromContains.includes(val)) { setFilterInput(""); return; }
    setFromContains((prev) => [...prev, val]);
    setFilterInput("");
    filterInputRef.current?.focus();
  }

  function removeFilter(f: string) {
    setFromContains((prev) => prev.filter((x) => x !== f));
  }

  async function save() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/email/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromContains, daysBack }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Save failed.");
        return;
      }
      await load();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function fetchNow() {
    if (fromContains.length === 0) { setError("Add at least one filter first."); return; }
    setError("");
    setJobState("running");

    try {
      const res = await fetch("/api/email/fetch", { method: "POST" });
      if (!res.ok) {
        setJobState("idle");
        setError("Could not trigger fetch — please try again.");
        return;
      }
      startPolling();
    } catch {
      setJobState("idle");
      setError("Network error — could not trigger fetch.");
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="max-w-lg mx-auto px-5 pb-24">
      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-30 flex items-center pt-10 pb-3 gap-3" style={{ background: "var(--color-background)" }}>
        <button onClick={() => router.back()} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ background: "var(--color-surface-container)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>arrow_back</span>
        </button>
        <h1 className="font-semibold" style={{ fontSize: 20 }}>Email Import</h1>
      </div>

      {loading ? (
        <div className="flex justify-center pt-16">
          <div className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin"
            style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
        </div>
      ) : (
        <div className="flex flex-col gap-5 pt-4">

          {/* From-contains filters */}
          <div>
            <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }} className="px-1 mb-2">
              Import from emails containing <span style={{ color: "var(--color-error)" }}>*</span>
            </p>
            <div className="rounded-2xl border p-4 flex flex-col gap-3"
              style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>

              {/* Chips */}
              {fromContains.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {fromContains.map((f) => (
                    <span key={f} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium"
                      style={{ background: "var(--color-primary-fixed)", color: "var(--color-primary)" }}>
                      {f}
                      <button onClick={() => removeFilter(f)} style={{ lineHeight: 1 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Input */}
              <div className="flex gap-2">
                <input
                  ref={filterInputRef}
                  type="text"
                  value={filterInput}
                  onChange={(e) => setFilterInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addFilter()}
                  placeholder="e.g. hdfcbank, swiggy.in, amazon"
                  className="flex-1 px-3 py-2 rounded-xl outline-none text-sm"
                  style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", border: "1px solid var(--color-outline-variant)" }}
                />
                <button onClick={addFilter} disabled={!filterInput.trim()}
                  className="px-4 py-2 rounded-xl font-medium text-sm"
                  style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", opacity: filterInput.trim() ? 1 : 0.4 }}>
                  Add
                </button>
              </div>
              <p style={{ fontSize: 12, color: "var(--color-outline)" }}>
                Substring match — "hdfcbank" matches any sender containing that string.
              </p>
            </div>
          </div>

          {/* Days back */}
          <div>
            <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }} className="px-1 mb-2">
              Fetch emails from last N days
            </p>
            <div className="rounded-2xl border p-4 flex items-center gap-4"
              style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
              <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)", flex: 1 }}>
                Only applies on first run. After that, only new emails are fetched.
              </p>
              <input
                type="number"
                min={1}
                max={365}
                value={daysBack}
                onChange={(e) => setDaysBack(Math.max(1, parseInt(e.target.value) || 7))}
                className="w-20 px-3 py-2 rounded-xl text-center font-semibold outline-none"
                style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", fontSize: 16, border: "1px solid var(--color-outline-variant)" }}
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="px-4 py-3 rounded-2xl text-sm" style={{ background: "var(--color-error-container)", color: "var(--color-on-error-container)" }}>
              {error}
            </p>
          )}

          {/* Save */}
          <button onClick={save} disabled={saving}
            className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
            style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 16, opacity: saving ? 0.7 : 1 }}>
            {saving
              ? <><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />Saving…</>
              : <><span className="material-symbols-outlined">save</span>Save settings</>}
          </button>

          {/* Divider */}
          <div style={{ borderTop: "1px solid var(--color-outline-variant)" }} />

          {/* Status + Fetch now */}
          <div className="flex flex-col gap-3">

            {/* Job running banner */}
            {jobState === "running" && (
              <div className="rounded-2xl p-4 flex items-start gap-3"
                style={{ background: "var(--color-primary-fixed)", border: "1px solid var(--color-outline-variant)" }}>
                <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0 mt-0.5"
                  style={{ borderColor: "var(--color-primary-fixed-dim)", borderTopColor: "var(--color-primary)" }} />
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }}>Scanning emails…</p>
                  <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)", marginTop: 2, lineHeight: 1.5 }}>
                    Running in background — this can take up to a few minutes. Stats will update automatically when done.
                  </p>
                </div>
              </div>
            )}

            {/* Job done banner */}
            {jobState === "done" && (
              <div className="rounded-2xl p-4 flex items-center gap-3"
                style={{ background: "var(--color-primary-fixed)", border: "1px solid var(--color-outline-variant)" }}>
                <span className="material-symbols-outlined flex-shrink-0" style={{ color: "var(--color-primary)", fontSize: 22 }}>check_circle</span>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }}>Fetch complete</p>
                  <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)", marginTop: 2 }}>Stats have been updated below.</p>
                </div>
              </div>
            )}

            {/* Last run stats */}
            {status?.lastRun && (
              <div className="rounded-2xl p-4" style={{ background: "var(--color-surface-container-lowest)", border: "1px solid var(--color-outline-variant)" }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-on-surface)" }}>Last run</p>
                <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)", marginTop: 2 }}>{formatDate(status.lastRun)}</p>
                <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)", marginTop: 6 }}>
                  {status.emailsScanned} emails scanned &nbsp;·&nbsp;
                  {status.emailsParsed} transactions added &nbsp;·&nbsp;
                  {status.emailsSkipped} skipped
                </p>
                {status.totalTxImported > 0 && (
                  <p style={{ fontSize: 12, color: "var(--color-outline)", marginTop: 4 }}>
                    {status.totalTxImported} total transactions imported from email
                  </p>
                )}
              </div>
            )}

            <button
              onClick={fetchNow}
              disabled={jobState !== "idle" || fromContains.length === 0}
              className="w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2"
              style={{
                background: "var(--color-surface-container)",
                color: "var(--color-on-surface)",
                fontSize: 15,
                opacity: (jobState !== "idle" || fromContains.length === 0) ? 0.5 : 1,
              }}>
              <span className="material-symbols-outlined">download</span>
              {jobState === "running" ? "Fetch running…" : "Fetch now"}
            </button>
          </div>

          {/* Info note */}
          <div className="rounded-2xl p-4 flex gap-3" style={{ background: "var(--color-primary-fixed)" }}>
            <span className="material-symbols-outlined flex-shrink-0" style={{ color: "var(--color-primary)", fontSize: 18 }}>info</span>
            <p style={{ fontSize: 13, color: "var(--color-primary)", lineHeight: 1.6 }}>
              Add at least one sender filter to activate auto-import. Runs once per day when you open the app. Only email text is read — images and attachments are never processed.
            </p>
          </div>

        </div>
      )}
    </div>
  );
}

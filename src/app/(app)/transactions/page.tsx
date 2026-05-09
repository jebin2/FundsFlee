"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Transaction } from "@/types";
import type { PendingSuggestion } from "@/app/api/items/suggestions/route";
import { TransactionRow, formatINR } from "@/components/TransactionRow";
import { useTransactions } from "@/hooks/useTransactions";

function groupByDate(txs: Transaction[]): Record<string, Transaction[]> {
  const groups: Record<string, Transaction[]> = {};
  for (const tx of txs) {
    (groups[tx.date] ??= []).push(tx);
  }
  return groups;
}

function TransactionsContent() {
  const searchParams = useSearchParams();
  const [, _setTransactions] = useState<Transaction[]>([]);
  // Map: tx_id → list of pending suggestions for that tx
  const [suggestions, setSuggestions] = useState<Record<string, PendingSuggestion[]>>({});
  const [activeSuggTxId, setActiveSuggTxId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [showDupsOnly, setShowDupsOnly] = useState(searchParams.get("duplicates_only") === "true");
  const [dupChecking, setDupChecking] = useState(false);
  const [dupError, setDupError] = useState<string | null>(null);
  const [activeDupGroup, setActiveDupGroup] = useState<{ original: Transaction; duplicates: Transaction[] } | null>(null);
  const [datePreset, setDatePreset] = useState<"week" | "month" | "year" | "custom" | "">("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const region = typeof window !== "undefined" ? localStorage.getItem("region") ?? "" : "";
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processingRef = useRef<Set<string>>(new Set());

  const { transactions, refresh } = useTransactions();

  const loadData = useCallback(async () => {
    try {
      return await refresh();
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load pending suggestions and trigger background normalization
  const loadSuggestions = useCallback(async (txList: Transaction[]) => {
    const [res] = await Promise.all([
      fetch("/api/items/suggestions"),
      fetch("/api/items/normalize", { method: "POST" }).catch(() => {}),
    ]);
    if (!res.ok) return;
    const data = await res.json();
    const pending: PendingSuggestion[] = data.suggestions ?? [];

    // Build map: tx_id → suggestions for that tx
    const map: Record<string, PendingSuggestion[]> = {};
    for (const s of pending) {
      if (s.source === "normalize" && s.tx_ids) {
        for (const txId of s.tx_ids) {
          const tx = txList.find((t) => t.id === txId);
          if (tx && tx.item_name?.toLowerCase() === s.current_val.toLowerCase()) {
            (map[txId] ??= []).push(s);
          }
        }
      } else if (s.source === "notes") {
        const txId = s.key.replace(/^tx:/, "");
        (map[txId] ??= []).push(s);
      }
    }
    setSuggestions(map);
  }, []);

  async function handleSuggestion(s: PendingSuggestion, action: "accept" | "reject") {
    // Optimistically remove from UI
    setSuggestions((prev) => {
      const next = { ...prev };
      for (const txId of Object.keys(next)) {
        next[txId] = next[txId].filter((x) => !(x.key === s.key && x.field === s.field));
        if (next[txId].length === 0) delete next[txId];
      }
      return next;
    });

    await fetch("/api/items/suggestions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: s.key, field: s.field, action }),
    });

    if (action === "accept") loadData();
  }

  // Trigger processing for queued entries (once per txId)
  const triggerProcessing = useCallback(async (txs: Transaction[]) => {
    const queued = txs.filter((t) => t.status === "queued" && !processingRef.current.has(t.id));
    for (const tx of queued) {
      processingRef.current.add(tx.id);
      fetch("/api/receipts/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txId: tx.id, region }),
      }).catch(() => processingRef.current.delete(tx.id));
    }
  }, [region]);

  useEffect(() => {
    loadData().then((txs) => {
      if (txs) {
        triggerProcessing(txs);
        loadSuggestions(txs);
      }
    });
  }, [loadData, triggerProcessing, loadSuggestions]);

  // Poll every 5s while any entry is queued or processing
  useEffect(() => {
    const hasInFlight = transactions.some((t) => t.status === "queued" || t.status === "processing");

    if (hasInFlight && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const txs = await loadData();
        if (txs) {
          triggerProcessing(txs);
          const stillInFlight = txs.some((t) => t.status === "queued" || t.status === "processing");
          if (!stillInFlight && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      }, 5000);
    }

    if (!hasInFlight && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [transactions, loadData, triggerProcessing]);

  const categories = [...new Set(transactions.map((t) => t.category).filter((c) => c && c !== "Others"))].sort();

  const today = new Date();
  const dateFrom = (() => {
    if (datePreset === "week") { const d = new Date(today); d.setDate(d.getDate() - d.getDay()); return d.toISOString().split("T")[0]; }
    if (datePreset === "month") return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    if (datePreset === "year") return `${today.getFullYear()}-01-01`;
    if (datePreset === "custom") return customFrom;
    return "";
  })();
  const dateTo = datePreset === "custom" ? customTo : datePreset ? today.toISOString().split("T")[0] : "";

  const filtered = transactions
    .filter((t) => !showDupsOnly || t.is_duplicate)
    .filter((t) => !filterCat || t.category === filterCat)
    .filter((t) => !dateFrom || t.date >= dateFrom)
    .filter((t) => !dateTo || t.date <= dateTo)
    .filter((t) =>
      !search ||
      t.item_name?.toLowerCase().includes(search.toLowerCase()) ||
      t.merchant.toLowerCase().includes(search.toLowerCase()) ||
      t.category?.toLowerCase().includes(search.toLowerCase()) ||
      t.notes?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      // Always put in-flight entries at the top
      const aFlight = a.status === "queued" || a.status === "processing" ? 1 : 0;
      const bFlight = b.status === "queued" || b.status === "processing" ? 1 : 0;
      if (aFlight !== bFlight) return bFlight - aFlight;
      return b.date.localeCompare(a.date) || b.time.localeCompare(a.time);
    });

  const groups = groupByDate(filtered);
  const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  function formatDate(d: string) {
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    if (d === today) return "Today";
    if (d === yesterday) return "Yesterday";
    return new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  }

  async function triggerDupDetect() {
    setDupChecking(true);
    setDupError(null);
    try {
      const res = await fetch("/api/duplicates/detect", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setDupError(
          data.error === "ai_unavailable"
            ? "AI service unavailable — check your API key in settings."
            : "Duplicate check failed. Please try again."
        );
      } else {
        await loadData();
      }
    } catch {
      setDupError("Network error — please try again.");
    } finally {
      setDupChecking(false);
    }
  }

  async function resolveDuplicate(tx: Transaction, action: "keep" | "remove") {
    await fetch(`/api/transactions/${tx.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updates: action === "remove" ? { deleted: true } : { is_duplicate: false, duplicate_ref: undefined },
      }),
    });
    setActiveDupGroup(null);
    loadData();
  }

  async function dismissGroup(group: { original: Transaction; duplicates: Transaction[] }) {
    await Promise.all(
      group.duplicates.map((t) =>
        fetch(`/api/transactions/${t.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: { is_duplicate: false, duplicate_ref: undefined } }),
        })
      )
    );
    setActiveDupGroup(null);
    loadData();
  }

  const inFlightCount = transactions.filter((t) => t.status === "queued" || t.status === "processing").length;

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6 pb-8 flex flex-col gap-4">
      <h1 className="hidden md:block font-bold" style={{ fontSize: 24, color: "var(--color-on-background)" }}>Transactions</h1>

      {/* In-flight banner */}
      {inFlightCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl" style={{ background: "var(--color-primary-fixed)" }}>
          <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin flex-shrink-0"
            style={{ borderColor: "var(--color-primary-fixed-dim)", borderTopColor: "var(--color-primary)" }} />
          <p style={{ fontSize: 14, color: "var(--color-primary)", fontWeight: 500 }}>
            {inFlightCount} receipt{inFlightCount > 1 ? "s" : ""} being processed by AI…
          </p>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl" style={{ background: "var(--color-surface-container)" }}>
        <span className="material-symbols-outlined" style={{ color: "var(--color-outline)", fontSize: 20 }}>search</span>
        <input type="text" placeholder="Search merchants, categories…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent focus:outline-none"
          style={{ fontSize: 15, color: "var(--color-on-surface)" }} />
        {search && (
          <button onClick={() => setSearch("")}>
            <span className="material-symbols-outlined" style={{ color: "var(--color-outline)", fontSize: 18 }}>close</span>
          </button>
        )}
      </div>

      {/* Date filter */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["week", "month", "year", "custom"] as const).map((p) => (
            <button key={p} onClick={() => setDatePreset(datePreset === p ? "" : p)}
              className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium"
              style={{ background: datePreset === p ? "var(--color-secondary-container)" : "var(--color-surface-container)", color: datePreset === p ? "var(--color-on-secondary-container)" : "var(--color-on-surface-variant)" }}>
              {p === "week" ? "This week" : p === "month" ? "This month" : p === "year" ? "This year" : "Custom"}
            </button>
          ))}
        </div>
        {datePreset === "custom" && (
          <div className="flex items-center gap-2 px-1">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl text-sm focus:outline-none"
              style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", border: "1px solid var(--color-outline-variant)" }} />
            <span style={{ color: "var(--color-outline)", fontSize: 13 }}>to</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl text-sm focus:outline-none"
              style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", border: "1px solid var(--color-outline-variant)" }} />
          </div>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => { const next = !showDupsOnly; setShowDupsOnly(next); if (next) triggerDupDetect(); }}
          className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium flex items-center gap-1.5"
          style={{ background: showDupsOnly ? "#fff3e0" : "var(--color-surface-container)", color: showDupsOnly ? "#e65100" : "var(--color-on-surface-variant)", border: showDupsOnly ? "1px solid #ffe0b2" : "none" }}>
          {dupChecking
            ? <><div className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#ffcc80", borderTopColor: "#e65100" }} />Checking…</>
            : <><span className="material-symbols-outlined" style={{ fontSize: 14 }}>warning</span>Duplicates</>}
        </button>
        <button onClick={() => setFilterCat("")}
          className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium"
          style={{ background: !filterCat ? "var(--color-primary)" : "var(--color-surface-container)", color: !filterCat ? "#fff" : "var(--color-on-surface-variant)" }}>
          All
        </button>
        {categories.map((cat) => (
          <button key={cat} onClick={() => setFilterCat(cat === filterCat ? "" : cat)}
            className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium"
            style={{ background: filterCat === cat ? "var(--color-primary)" : "var(--color-surface-container)", color: filterCat === cat ? "#fff" : "var(--color-on-surface-variant)" }}>
            {cat}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: "var(--color-surface-container)" }} />
          ))}
        </div>
      ) : showDupsOnly ? (() => {
        // Build duplicate groups: original tx → list of its duplicates
        const dupTxs = transactions.filter((t) => t.is_duplicate && t.duplicate_ref);
        const groupMap: Record<string, Transaction[]> = {};
        for (const t of dupTxs) {
          (groupMap[t.duplicate_ref!] ??= []).push(t);
        }
        const dupGroups = Object.entries(groupMap).map(([origId, dups]) => ({
          original: transactions.find((t) => t.id === origId),
          duplicates: dups,
        })).filter((g) => g.original);

        if (dupChecking) return (
          <div className="flex flex-col items-center py-16 gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#ffcc80", borderTopColor: "#e65100" }} />
            <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>AI is checking for duplicates…</p>
          </div>
        );
        if (dupError) return (
          <div className="flex flex-col items-center py-16 gap-4 text-center px-4">
            <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: "var(--color-error-container)" }}>
              <span className="material-symbols-outlined" style={{ color: "var(--color-error)", fontSize: 28 }}>error</span>
            </div>
            <p style={{ fontSize: 16, fontWeight: 600, color: "var(--color-on-surface)" }}>Check failed</p>
            <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>{dupError}</p>
            <button onClick={triggerDupDetect}
              className="px-5 py-2.5 rounded-2xl font-semibold"
              style={{ background: "var(--color-primary)", color: "#fff", fontSize: 14, cursor: "pointer" }}>
              Retry
            </button>
          </div>
        );
        if (dupGroups.length === 0) return (
          <div className="flex flex-col items-center py-16 gap-4 text-center">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl" style={{ background: "var(--color-surface-container)" }}>✅</div>
            <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-on-surface)" }}>No duplicates found</p>
            <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>All your transactions look unique</p>
          </div>
        );
        return (
          <div className="flex flex-col gap-2">
            {dupGroups.map(({ original: orig, duplicates }) => (
              <button key={orig!.id} onClick={() => setActiveDupGroup({ original: orig!, duplicates })}
                className="flex items-center gap-4 p-4 rounded-2xl text-left w-full"
                style={{ background: "#fff8f0", border: "1px solid #ffe0b2" }}>
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "#fff3e0" }}>
                  <span className="material-symbols-outlined" style={{ color: "#e65100", fontSize: 20, fontVariationSettings: "'FILL' 1" }}>content_copy</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium" style={{ color: "var(--color-on-surface)" }}>{orig!.item_name || orig!.merchant}</p>
                  <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{orig!.date} · {formatINR(orig!.amount)}</p>
                </div>
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-full" style={{ background: "#ffcc80" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#e65100" }}>×{duplicates.length + 1}</span>
                </div>
              </button>
            ))}
          </div>
        );
      })() : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-4 text-center">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl" style={{ background: "var(--color-surface-container)" }}>🧾</div>
          <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-on-surface)" }}>No transactions found</p>
          <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>
            {search ? "Try a different search term" : "Add your first expense to get started"}
          </p>
          <Link href="/add" className="px-6 py-3 rounded-2xl font-semibold" style={{ background: "var(--color-primary)", color: "#fff" }}>
            Add manually
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {sortedDates.map((date) => (
            <div key={date}>
              <div className="flex justify-between items-center mb-2 px-1">
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-outline)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{formatDate(date)}</p>
                <p style={{ fontSize: 13, color: "var(--color-outline)" }}>
                  {formatINR(groups[date].filter((t) => t.status !== "queued" && t.status !== "processing").reduce((s, t) => s + t.amount, 0))}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {groups[date].map((tx) => {
                  const isInFlight = tx.status === "queued" || tx.status === "processing";
                  const txSuggestions = suggestions[tx.id] ?? [];
                  const isFailed = tx.status === "failed";

                  return (
                    <div key={tx.id}>
                      <TransactionRow
                        tx={tx}
                        hasSuggestions={!isInFlight && txSuggestions.length > 0}
                        onSuggestionsClick={() => setActiveSuggTxId(tx.id)}
                      />

                      {tx.is_duplicate && tx.status === "done" && (
                        <div className="ml-4 mt-1 flex gap-2 px-3">
                          <button onClick={() => resolveDuplicate(tx, "keep")}
                            className="px-4 py-1.5 rounded-xl text-sm font-medium"
                            style={{ background: "var(--color-primary-fixed)", color: "var(--color-primary)" }}>Keep</button>
                          <button onClick={() => resolveDuplicate(tx, "remove")}
                            className="px-4 py-1.5 rounded-xl text-sm font-medium"
                            style={{ background: "var(--color-error-container)", color: "var(--color-error)" }}>Remove</button>
                        </div>
                      )}

                      {/* Failed entry — retry or fill manually */}
                      {isFailed && (
                        <div className="ml-4 mt-1 flex gap-2 px-3">
                          <Link href={`/transactions/${tx.id}?edit=true`}
                            className="px-4 py-1.5 rounded-xl text-sm font-medium"
                            style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)" }}>
                            Fill manually
                          </Link>
                          <button
                            onClick={async () => {
                              await fetch("/api/receipts/process", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ txId: tx.id, region }),
                              });
                              loadData();
                            }}
                            className="px-4 py-1.5 rounded-xl text-sm font-medium"
                            style={{ background: "var(--color-primary-fixed)", color: "var(--color-primary)" }}>
                            Retry AI
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI suggestions modal */}
      {activeSuggTxId && (() => {
        const suggs = suggestions[activeSuggTxId] ?? [];
        const fieldLabel: Record<string, string> = { item_name: "Item", quantity: "Qty", merchant: "Shop" };
        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
            onClick={() => setActiveSuggTxId(null)}>
            <div className="w-full max-w-lg rounded-t-3xl overflow-hidden flex flex-col"
              style={{ background: "var(--color-surface)", maxHeight: "70vh" }}
              onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20, fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                  <p style={{ fontSize: 17, fontWeight: 700, color: "var(--color-on-surface)" }}>AI Suggestions</p>
                </div>
                <button onClick={() => setActiveSuggTxId(null)}
                  className="w-9 h-9 rounded-full flex items-center justify-center"
                  style={{ background: "var(--color-surface-container)", cursor: "pointer" }}>
                  <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)", fontSize: 18 }}>close</span>
                </button>
              </div>
              <div className="px-4 pb-8 flex flex-col gap-3 overflow-y-auto">
                {suggs.map((s) => (
                  <div key={`${s.key}-${s.field}`} className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                    style={{ background: "var(--color-surface-container-lowest)", border: "1px solid var(--color-surface-variant)" }}>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: 11, color: "var(--color-primary)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        {fieldLabel[s.field] ?? s.field}
                      </p>
                      <p style={{ fontSize: 14, color: "var(--color-on-surface)", marginTop: 2 }}>
                        {s.current_val && <><s style={{ color: "var(--color-on-surface-variant)", fontWeight: 400 }}>{s.current_val}</s>{" → "}</>}
                        <strong>{s.suggested}</strong>
                      </p>
                      {s.source === "normalize" && (
                        <p style={{ fontSize: 11, color: "var(--color-outline)", marginTop: 2 }}>Applies to all matching entries</p>
                      )}
                    </div>
                    <button
                      onClick={() => { handleSuggestion(s, "reject"); if ((suggestions[activeSuggTxId] ?? []).length <= 1) setActiveSuggTxId(null); }}
                      className="flex-shrink-0 px-3 py-1.5 rounded-xl text-sm font-medium"
                      style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", cursor: "pointer" }}>
                      No
                    </button>
                    <button
                      onClick={() => { handleSuggestion(s, "accept"); if ((suggestions[activeSuggTxId] ?? []).length <= 1) setActiveSuggTxId(null); }}
                      className="flex-shrink-0 px-3 py-1.5 rounded-xl text-sm font-semibold"
                      style={{ background: "var(--color-primary)", color: "#fff", cursor: "pointer" }}>
                      Use
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Duplicate group modal */}
      {activeDupGroup && (
        <div className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
          onClick={() => setActiveDupGroup(null)}>
          <div className="w-full max-w-lg rounded-t-3xl overflow-hidden flex flex-col"
            style={{ background: "var(--color-surface)", maxHeight: "80vh" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <div>
                <p style={{ fontSize: 17, fontWeight: 700, color: "var(--color-on-surface)" }}>Duplicate entries</p>
                <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{activeDupGroup.duplicates.length + 1} entries · keep one or dismiss</p>
              </div>
              <button onClick={() => setActiveDupGroup(null)}
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: "var(--color-surface-container)", cursor: "pointer" }}>
                <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)", fontSize: 18 }}>close</span>
              </button>
            </div>
            <div className="px-4 pb-4 flex flex-col gap-2 overflow-y-auto">
              {[activeDupGroup.original, ...activeDupGroup.duplicates].map((tx, i) => (
                <div key={tx.id} className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                  style={{ background: i === 0 ? "var(--color-primary-fixed)" : "var(--color-surface-container-lowest)", border: `1px solid ${i === 0 ? "var(--color-primary-fixed-dim)" : "var(--color-surface-variant)"}` }}>
                  <div className="flex-1 min-w-0">
                    {i === 0 && <p style={{ fontSize: 10, color: "var(--color-primary)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Original</p>}
                    <p className="truncate font-medium" style={{ fontSize: 14, color: "var(--color-on-surface)" }}>{tx.item_name || tx.merchant}</p>
                    <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>{tx.date} · {tx.time} · {formatINR(tx.amount)}</p>
                  </div>
                  <button onClick={() => resolveDuplicate(tx, "remove")}
                    className="flex-shrink-0 px-3 py-1.5 rounded-xl text-sm font-medium"
                    style={{ background: "var(--color-error-container)", color: "var(--color-error)", cursor: "pointer" }}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="px-4 pb-6">
              <button onClick={() => dismissGroup(activeDupGroup)}
                className="w-full py-3 rounded-2xl font-semibold"
                style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", fontSize: 15, cursor: "pointer" }}>
                Keep all (not duplicates)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TransactionsPage() {
  return <Suspense><TransactionsContent /></Suspense>;
}

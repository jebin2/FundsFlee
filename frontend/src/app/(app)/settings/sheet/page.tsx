"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTransactions } from "@/hooks/useTransactions";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export default function SheetSettingsPage() {
  const router = useRouter();
  const { transactions, refresh } = useTransactions();
  const isOnline = useOnlineStatus();
  const [sheetUrl, setSheetUrl] = useState("");
  const [lastSynced, setLastSynced] = useState("—");
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!isOnline) return;
    fetch("/api/user/profile")
      .then((r) => r.json())
      .then((d) => { if (d.sheet_url) setSheetUrl(d.sheet_url); })
      .catch(() => {});
  }, [isOnline]);

  async function syncNow() {
    if (!isOnline) return;
    setSyncing(true);
    try {
      await refresh();
      setLastSynced(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto px-5 pb-10">
      <div className="md:hidden sticky top-0 z-30 flex items-center pt-10 pb-3 gap-3" style={{ background: "var(--color-background)" }}>
        <button onClick={() => router.back()} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ background: "var(--color-surface-container)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>arrow_back</span>
        </button>
        <h1 className="font-semibold" style={{ fontSize: 20 }}>Google Sheet</h1>
      </div>

      <div className="flex flex-col gap-4 pt-4">
        <div className="rounded-3xl border p-4" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)", boxShadow: "0 4px 12px rgba(31,16,142,0.06)" }}>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "#e8f5e9" }}>
              <span className="material-symbols-outlined" style={{ color: "#2e7d32", fontSize: 28 }}>table_chart</span>
            </div>
            <div>
              <p style={{ fontSize: 17, fontWeight: 600, color: "var(--color-on-surface)" }}>FundsFlee</p>
              <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>Your Google Drive</p>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-2 h-2 rounded-full" style={{ background: isOnline ? "#4caf50" : "#9e9e9e" }} />
                <span style={{ fontSize: 12, color: isOnline ? "#2e7d32" : "var(--color-outline)", fontWeight: 600 }}>
                  {isOnline ? "Connected" : "Offline"}
                </span>
              </div>
            </div>
          </div>
          {sheetUrl ? (
            <a href={sheetUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2"
              style={{ color: "var(--color-primary)", fontSize: 14, fontWeight: 500 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>open_in_new</span>
              Open in Google Sheets
            </a>
          ) : (
            <p style={{ fontSize: 14, color: "var(--color-outline)" }}>
              {isOnline ? "Sheet URL loading…" : "Available when online"}
            </p>
          )}
        </div>

        <div className="rounded-3xl border overflow-hidden" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
          {[
            { label: "Last synced", value: lastSynced },
            { label: "Total transactions", value: `${transactions.length} rows` },
          ].map(({ label, value }, i, arr) => (
            <div key={label} className="flex justify-between items-center px-4 py-3.5"
              style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--color-surface-variant)" : "none" }}>
              <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>{label}</p>
              <p style={{ fontSize: 14, fontWeight: 500, color: "var(--color-on-surface)" }}>{value}</p>
            </div>
          ))}
          <div className="p-4">
            <button onClick={syncNow} disabled={syncing || !isOnline}
              className="w-full border py-3 rounded-xl flex items-center justify-center gap-2 font-medium transition-all"
              style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)", fontSize: 14, opacity: (syncing || !isOnline) ? 0.5 : 1 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>sync</span>
              {syncing ? "Syncing…" : isOnline ? "Sync Now" : "Offline"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

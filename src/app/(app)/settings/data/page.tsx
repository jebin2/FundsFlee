"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { Transaction } from "@/types";
import { todayISO } from "@/lib/date/iso";
import { useTransactions } from "@/hooks/useTransactions";

export default function DataSettingsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { transactions } = useTransactions();
  const [exporting, setExporting] = useState(false);
  async function exportCSV() {
    setExporting(true);
    try {
      // Use cached transactions from store — works offline
      const txs: Transaction[] = transactions;

      const headers = ["Date", "Time", "Merchant", "Category", "Subcategory", "Amount", "Payment", "Source", "Notes", "Tags"];
      const rows = txs.map((t) => [
        t.date, t.time, t.merchant, t.category, t.subcategory ?? "",
        t.amount, t.payment_method, t.source, t.notes ?? "",
        (t.tags ?? []).join(";"),
      ]);

      const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `FundsFlee-${todayISO()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed");
    } finally {
      setExporting(false);
    }
  }

  const items = [
    {
      icon: "download",
      label: "Export as CSV",
      sub: "Download all transactions as a spreadsheet",
      action: exportCSV,
      loading: exporting,
      color: "var(--color-primary)",
      bg: "var(--color-primary-fixed)",
    },
    {
      icon: "open_in_new",
      label: "Open in Google Sheets",
      sub: "View raw data directly in your sheet",
      action: () => {
        const id = session?.sheet_id;
        if (id) window.open(`https://docs.google.com/spreadsheets/d/${id}/edit`, "_blank");
        else alert("No sheet connected");
      },
      loading: false,
      color: "#2e7d32",
      bg: "#e8f5e9",
    },
  ];

  return (
    <div className="max-w-lg mx-auto px-5 pb-10">
      <div className="md:hidden sticky top-0 z-30 flex items-center pt-10 pb-3 gap-3" style={{ background: "var(--color-background)" }}>
        <button onClick={() => router.back()} className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ background: "var(--color-surface-container)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>arrow_back</span>
        </button>
        <h1 className="font-semibold" style={{ fontSize: 20 }}>Data & Export</h1>
      </div>

      <div className="flex flex-col gap-4 pt-4">
        <div className="rounded-3xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
          {items.map((item, i) => (
            <button
              key={item.label}
              onClick={item.action}
              disabled={item.loading}
              className="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors"
              style={{ borderBottom: i < items.length - 1 ? "1px solid var(--color-surface-variant)" : "none", opacity: item.loading ? 0.6 : 1 }}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: item.bg }}>
                {item.loading
                  ? <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: `${item.color}40`, borderTopColor: item.color }} />
                  : <span className="material-symbols-outlined" style={{ color: item.color, fontSize: 20 }}>{item.icon}</span>
                }
              </div>
              <div className="flex-1">
                <p style={{ fontSize: 15, fontWeight: 500, color: "var(--color-on-surface)" }}>{item.label}</p>
                <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{item.sub}</p>
              </div>
              <span className="material-symbols-outlined" style={{ color: "var(--color-outline)", fontSize: 20 }}>chevron_right</span>
            </button>
          ))}
        </div>

      </div>
    </div>
  );
}

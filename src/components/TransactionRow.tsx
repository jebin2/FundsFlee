"use client";

import Link from "next/link";
import type { Transaction, TransactionStatus } from "@/types";

export const categoryIcons: Record<string, string> = {
  "Food & Dining": "restaurant", Transport: "directions_car", Shopping: "shopping_bag",
  Entertainment: "movie", Health: "medical_services", "Bills & Utilities": "electric_bolt",
  Education: "school", "Personal Care": "spa", "Gifts & Donations": "card_giftcard", Others: "category",
};

export function formatINR(n: number) {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function StatusBadge({ status }: { status: TransactionStatus }) {
  if (status === "done" || !status) return null;
  const map: Record<string, { label: string; icon: string; bg: string; color: string }> = {
    queued: { label: "Queued", icon: "schedule", bg: "#fff3e0", color: "#e65100" },
    processing: { label: "AI reading…", icon: "auto_awesome", bg: "var(--color-primary-fixed)", color: "var(--color-primary)" },
    failed: { label: "Parse failed", icon: "error", bg: "var(--color-error-container)", color: "var(--color-error)" },
  };
  const s = map[status];
  if (!s) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: s.bg, color: s.color }}>
      <span className="material-symbols-outlined"
        style={{ fontSize: 12, fontVariationSettings: status === "processing" ? "'FILL' 1" : "normal" }}>{s.icon}</span>
      {s.label}
    </span>
  );
}

interface TransactionRowProps {
  tx: Transaction;
  /** "merchant-payment" (default) for transactions list; "category-date" for dashboard */
  subtitleMode?: "merchant-payment" | "category-date";
  hasSuggestions?: boolean;
  onSuggestionsClick?: (e: React.MouseEvent) => void;
}

export function TransactionRow({ tx, subtitleMode = "merchant-payment", hasSuggestions, onSuggestionsClick }: TransactionRowProps) {
  const isInFlight = tx.status === "queued" || tx.status === "processing";
  const isFailed = tx.status === "failed";

  const primaryLabel = isInFlight
    ? "Reading receipt…"
    : isFailed
    ? "Receipt — parse failed"
    : (tx.item_name || tx.merchant);

  const subtitle = subtitleMode === "category-date"
    ? `${tx.category}${tx.date ? ` · ${tx.date}` : ""}`
    : [tx.merchant !== "Unknown" ? tx.merchant : null, tx.payment_method].filter(Boolean).join(" · ");

  return (
    <Link
      href={`/transactions/${tx.id}`}
      className="flex items-center gap-4 p-4 rounded-2xl"
      style={{
        background: isInFlight
          ? "var(--color-primary-fixed)"
          : isFailed
          ? "var(--color-error-container)"
          : tx.is_duplicate
          ? "#fff8f0"
          : "var(--color-surface-container-lowest)",
        border: `1px solid ${
          isInFlight
            ? "var(--color-primary-fixed-dim)"
            : isFailed
            ? "var(--color-on-error-container)"
            : tx.is_duplicate
            ? "#ffe0b2"
            : "var(--color-surface-variant)"
        }`,
      }}
    >
      {/* Icon */}
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ background: isInFlight ? "rgba(31,16,142,0.1)" : isFailed ? "var(--color-error-container)" : "var(--color-primary-fixed)" }}>
        {isInFlight ? (
          <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "var(--color-primary-fixed-dim)", borderTopColor: "var(--color-primary)" }} />
        ) : (
          <span className="material-symbols-outlined"
            style={{ color: isFailed ? "var(--color-error)" : "var(--color-primary)", fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
            {isFailed ? "error" : tx.is_duplicate ? "warning" : (categoryIcons[tx.category] ?? "category")}
          </span>
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="truncate font-medium" style={{ color: "var(--color-on-surface)" }}>{primaryLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={tx.status ?? "done"} />
          {!isInFlight && !isFailed && (
            <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{subtitle}</p>
          )}
        </div>
      </div>

      {/* Amount + suggestion indicator */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="text-right">
          {!isInFlight && tx.amount > 0 && (
            <p style={{ fontWeight: 600, color: "var(--color-on-surface)" }}>{formatINR(tx.amount)}</p>
          )}
          {tx.is_duplicate && (
            <span style={{ fontSize: 10, color: "#e65100", fontWeight: 600, background: "#fff3e0", padding: "2px 6px", borderRadius: 4 }}>DUP</span>
          )}
          {tx.receipt_url && (
            <span className="material-symbols-outlined" style={{ color: "var(--color-outline)", fontSize: 16 }}>attach_file</span>
          )}
        </div>
        {hasSuggestions && onSuggestionsClick && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSuggestionsClick(e); }}
            style={{ color: "var(--color-primary)", cursor: "pointer", flexShrink: 0 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
          </button>
        )}
      </div>
    </Link>
  );
}

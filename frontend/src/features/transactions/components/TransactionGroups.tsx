import Link from "next/link";
import type { PendingSuggestion, Transaction } from "@/types";
import { TransactionRow } from "@/components/TransactionRow";
import { formatINR } from "@/lib/format/currency";
import { formatTransactionDateLabel } from "@/features/transactions/utils/list";
import { EmptyState } from "@/components/ui/EmptyState";

interface TransactionGroupsProps {
  sortedDates: string[];
  groups: Record<string, Transaction[]>;
  suggestions: Record<string, PendingSuggestion[]>;
  onSuggestionsClick: (txId: string) => void;
  onTransactionClick: (tx: Transaction) => void;
  onResolveDuplicate: (tx: Transaction, action: "keep" | "remove") => void;
  onRetryReceipt: (txId: string) => void;
  searchActive: boolean;
}

export function TransactionGroups({
  sortedDates,
  groups,
  suggestions,
  onSuggestionsClick,
  onTransactionClick,
  onResolveDuplicate,
  onRetryReceipt,
  searchActive,
}: TransactionGroupsProps) {
  if (sortedDates.length === 0) {
    return (
      <EmptyState
        icon="🧾"
        title="No transactions found"
        description={searchActive ? "Try a different search term" : "Add your first expense to get started"}
        action={!searchActive ? (
          <Link href="/add" className="px-6 py-3 rounded-2xl font-semibold" style={{ background: "var(--color-primary)", color: "#fff" }}>
            Add manually
          </Link>
        ) : undefined}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {sortedDates.map((date) => (
        <div key={date}>
          <div className="flex justify-between items-center mb-2 px-1">
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-outline)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {formatTransactionDateLabel(date)}
            </p>
            <p style={{ fontSize: 13, color: "var(--color-outline)" }}>
              {formatINR(
                groups[date]
                  .filter((t) => t.status !== "queued" && t.status !== "processing")
                  .reduce((s, t) => s + t.amount, 0)
              )}
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
                    onSuggestionsClick={() => onSuggestionsClick(tx.id)}
                    onClick={() => onTransactionClick(tx)}
                  />
                  {tx.is_duplicate && tx.status === "done" && (
                    <div className="ml-4 mt-1 flex gap-2 px-3">
                      <button
                        onClick={() => onResolveDuplicate(tx, "keep")}
                        className="px-4 py-1.5 rounded-xl text-sm font-medium"
                        style={{ background: "var(--color-primary-fixed)", color: "var(--color-primary)" }}
                      >
                        Keep
                      </button>
                      <button
                        onClick={() => onResolveDuplicate(tx, "remove")}
                        className="px-4 py-1.5 rounded-xl text-sm font-medium"
                        style={{ background: "var(--color-error-container)", color: "var(--color-error)" }}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                  {isFailed && (
                    <div className="ml-4 mt-1 flex gap-2 px-3">
                      <button
                        onClick={() => onTransactionClick(tx)}
                        className="px-4 py-1.5 rounded-xl text-sm font-medium"
                        style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)" }}
                      >
                        Fill manually
                      </button>
                      <button
                        onClick={() => onRetryReceipt(tx.id)}
                        className="px-4 py-1.5 rounded-xl text-sm font-medium"
                        style={{ background: "var(--color-primary-fixed)", color: "var(--color-primary)" }}
                      >
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
  );
}

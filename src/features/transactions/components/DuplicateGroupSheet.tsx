import { useState } from "react";
import { formatINR } from "@/lib/format/currency";
import type { DuplicateGroup } from "@/features/transactions/utils/list";
import type { Transaction } from "@/types";
import { BottomSheet, BottomSheetHeader } from "@/components/ui/BottomSheet";
import { duplicatesApi } from "@/lib/api/duplicates";

interface DuplicateGroupSheetProps {
  group: DuplicateGroup;
  onRemove: (tx: Transaction) => void;
  onDismissAll: () => void;
  onClose: () => void;
  onViewTransaction: (tx: Transaction) => void;
  isMerging?: boolean;
}

export function DuplicateGroupSheet({ group, onRemove, onDismissAll, onClose, onViewTransaction, isMerging: serverMerging = false }: DuplicateGroupSheetProps) {
  const [merging, setMerging] = useState(false);
  const anyMerging = merging || serverMerging;
  const [mergeError, setMergeError] = useState<string | null>(null);

  async function handleMerge() {
    if (merging) return;
    setMerging(true);
    setMergeError(null);
    try {
      const allIds = [group.original.id, ...group.duplicates.map((d) => d.id)];
      const res = await duplicatesApi.merge(allIds);
      if (!res.ok) throw new Error("Merge failed — please try again.");
      onClose();
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : "Merge failed.");
      setMerging(false);
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <BottomSheetHeader
        title="Duplicate entries"
        subtitle={anyMerging
          ? "AI is merging these entries…"
          : `${group.duplicates.length + 1} entries · tap to view · keep one or dismiss`}
        onClose={onClose}
      />
      <div className="px-4 pb-4 flex flex-col gap-2 overflow-y-auto">
        {[group.original, ...group.duplicates].map((tx, i) => (
          <button
            key={tx.id}
            onClick={() => !anyMerging && onViewTransaction(tx)}
            disabled={anyMerging}
            className="flex items-center gap-3 px-4 py-3 rounded-2xl w-full text-left"
            style={{
              background: i === 0 ? "var(--color-primary-fixed)" : "var(--color-surface-container-lowest)",
              border: `1px solid ${i === 0 ? "var(--color-primary-fixed-dim)" : "var(--color-surface-variant)"}`,
              cursor: anyMerging ? "default" : "pointer",
              opacity: anyMerging ? 0.6 : 1,
            }}
          >
            <div className="flex-1 min-w-0">
              {i === 0 && (
                <p style={{ fontSize: 10, color: "var(--color-primary)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
                  Original
                </p>
              )}
              <p className="truncate font-medium" style={{ fontSize: 14, color: "var(--color-on-surface)" }}>{tx.item_name || tx.merchant}</p>
              <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>{tx.date} · {tx.time} · {formatINR(tx.amount)}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {!anyMerging && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(tx); }}
                  className="px-3 py-1.5 rounded-xl text-sm font-medium"
                  style={{ background: "var(--color-error-container)", color: "var(--color-error)", cursor: "pointer" }}
                >
                  Remove
                </button>
              )}
              <span className="material-symbols-outlined" style={{ color: "var(--color-outline)", fontSize: 18 }}>
                {anyMerging ? "hourglass_empty" : "chevron_right"}
              </span>
            </div>
          </button>
        ))}
      </div>
      <div className="px-4 pb-6 flex-shrink-0 flex flex-col gap-2">
        {mergeError && !anyMerging && (
          <p className="text-center text-sm px-2" style={{ color: "var(--color-error)" }}>{mergeError}</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleMerge}
            disabled={anyMerging}
            className="flex-1 py-3 rounded-2xl font-semibold flex items-center justify-center gap-2"
            style={{
              background: "var(--color-primary)",
              color: "#fff",
              fontSize: 15,
              opacity: anyMerging ? 0.6 : 1,
              cursor: anyMerging ? "not-allowed" : "pointer",
            }}
          >
            {anyMerging
              ? <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />
              : <span className="material-symbols-outlined" style={{ fontSize: 18 }}>merge</span>
            }
            {anyMerging ? "Merging…" : "Merge into one"}
          </button>
          <button
            onClick={onDismissAll}
            disabled={anyMerging}
            className="flex-1 py-3 rounded-2xl font-semibold"
            style={{
              background: "var(--color-surface-container)",
              color: "var(--color-on-surface-variant)",
              fontSize: 15,
              opacity: anyMerging ? 0.4 : 1,
              cursor: anyMerging ? "not-allowed" : "pointer",
            }}
          >
            Keep all
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

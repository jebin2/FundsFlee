import { formatINR } from "@/lib/format/currency";
import { getDuplicateGroups, type DuplicateGroup } from "@/features/transactions/utils/list";
import type { Transaction } from "@/types";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";

interface DuplicateGroupsListProps {
  transactions: Transaction[];
  dupChecking: boolean;
  dupError: string | null;
  onRetry: () => void;
  onGroupClick: (group: DuplicateGroup) => void;
  mergingSourceIds?: Set<string>;
}

export function DuplicateGroupsList({
  transactions, dupChecking, dupError, onRetry, onGroupClick, mergingSourceIds = new Set(),
}: DuplicateGroupsListProps) {
  if (dupChecking) {
    return (
      <div className="flex flex-col items-center py-16 gap-3">
        <Spinner size={32} color="#ffcc80" activeColor="#e65100" />
        <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>AI is checking for duplicates…</p>
      </div>
    );
  }

  if (dupError) {
    return (
      <div className="flex flex-col items-center py-16 gap-4 text-center px-4">
        <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: "var(--color-error-container)" }}>
          <span className="material-symbols-outlined" style={{ color: "var(--color-error)", fontSize: 28 }}>error</span>
        </div>
        <p style={{ fontSize: 16, fontWeight: 600, color: "var(--color-on-surface)" }}>Check failed</p>
        <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>{dupError}</p>
        <button
          onClick={onRetry}
          className="px-5 py-2.5 rounded-2xl font-semibold"
          style={{ background: "var(--color-primary)", color: "#fff", fontSize: 14, cursor: "pointer" }}
        >
          Retry
        </button>
      </div>
    );
  }

  const dupGroups = getDuplicateGroups(transactions);

  if (dupGroups.length === 0) {
    return <EmptyState icon="✅" title="No duplicates found" description="All your transactions look unique" />;
  }

  return (
    <div className="flex flex-col gap-2">
      {dupGroups.map(({ original: orig, duplicates }) => {
        const allIds = [orig.id, ...duplicates.map((d) => d.id)];
        const isGroupMerging = allIds.some((id) => mergingSourceIds.has(id));

        return (
          <button
            key={orig.id}
            onClick={() => !isGroupMerging && onGroupClick({ original: orig, duplicates })}
            disabled={isGroupMerging}
            className="flex items-center gap-4 p-4 rounded-2xl text-left w-full"
            style={{
              background: isGroupMerging ? "var(--color-primary-fixed)" : "#fff8f0",
              border: `1px solid ${isGroupMerging ? "var(--color-primary-fixed-dim)" : "#ffe0b2"}`,
              opacity: isGroupMerging ? 1 : 1,
              cursor: isGroupMerging ? "default" : "pointer",
            }}
          >
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: isGroupMerging ? "var(--color-primary-fixed-dim)" : "#fff3e0" }}>
              {isGroupMerging
                ? <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
                    style={{ borderColor: "rgba(var(--color-primary-rgb),0.3)", borderTopColor: "var(--color-primary)" }} />
                : <span className="material-symbols-outlined" style={{ color: "#e65100", fontSize: 20, fontVariationSettings: "'FILL' 1" }}>content_copy</span>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate font-medium" style={{ color: "var(--color-on-surface)" }}>{orig.item_name || orig.merchant}</p>
              <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{orig.date} · {formatINR(orig.amount)}</p>
            </div>
            {isGroupMerging
              ? <span className="text-xs px-2.5 py-1 rounded-full font-semibold flex-shrink-0"
                  style={{ background: "var(--color-primary-fixed-dim)", color: "var(--color-primary)" }}>
                  Merging…
                </span>
              : <div className="flex items-center gap-1 px-2.5 py-1 rounded-full flex-shrink-0" style={{ background: "#ffcc80" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#e65100" }}>×{duplicates.length + 1}</span>
                </div>
            }
          </button>
        );
      })}
    </div>
  );
}

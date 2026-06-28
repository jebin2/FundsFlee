import type { PendingSuggestion } from "@/types";
import { BottomSheet, BottomSheetHeader } from "@/components/ui/BottomSheet";

interface SuggestionsSheetProps {
  txId: string;
  suggestions: Record<string, PendingSuggestion[]>;
  onAction: (s: PendingSuggestion, action: "accept" | "reject") => void;
  onClose: () => void;
}

const FIELD_LABEL: Record<string, string> = { item_name: "Item", quantity: "Qty", merchant: "Shop" };

export function SuggestionsSheet({ txId, suggestions, onAction, onClose }: SuggestionsSheetProps) {
  const suggs = suggestions[txId] ?? [];

  return (
    <BottomSheet onClose={onClose} maxHeight="70vh">
      <BottomSheetHeader
        title="AI Suggestions"
        onClose={onClose}
        icon={<span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20, fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>}
      />
      <div className="px-4 pb-8 flex flex-col gap-3 overflow-y-auto">
        {suggs.map((s) => (
          <div
            key={`${s.key}-${s.field}`}
            className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: "var(--color-surface-container-lowest)", border: "1px solid var(--color-surface-variant)" }}
          >
            <div className="flex-1 min-w-0">
              <p style={{ fontSize: 11, color: "var(--color-primary)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {FIELD_LABEL[s.field] ?? s.field}
              </p>
              <p style={{ fontSize: 14, color: "var(--color-on-surface)", marginTop: 2 }}>
                {s.current_val && (
                  <><s style={{ color: "var(--color-on-surface-variant)", fontWeight: 400 }}>{s.current_val}</s>{" → "}</>
                )}
                <strong>{s.suggested}</strong>
              </p>
              {s.source === "normalize" && (
                <p style={{ fontSize: 11, color: "var(--color-outline)", marginTop: 2 }}>Applies to all matching entries</p>
              )}
            </div>
            <button
              onClick={() => { onAction(s, "reject"); if (suggs.length <= 1) onClose(); }}
              className="flex-shrink-0 px-3 py-1.5 rounded-xl text-sm font-medium"
              style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", cursor: "pointer" }}
            >
              No
            </button>
            <button
              onClick={() => { onAction(s, "accept"); if (suggs.length <= 1) onClose(); }}
              className="flex-shrink-0 px-3 py-1.5 rounded-xl text-sm font-semibold"
              style={{ background: "var(--color-primary)", color: "#fff", cursor: "pointer" }}
            >
              Use
            </button>
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}

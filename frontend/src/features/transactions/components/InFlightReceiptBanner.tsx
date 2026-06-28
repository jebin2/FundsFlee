import { Spinner } from "@/components/ui/Spinner";
import type { Transaction } from "@/types";

interface InFlightReceiptBannerProps {
  transactions: Transaction[];
}

export function InFlightReceiptBanner({ transactions }: InFlightReceiptBannerProps) {
  const receiptCount = transactions.filter(
    (t) => t.status === "queued" || t.status === "processing"
  ).length;
  const mergeCount = transactions.filter((t) => t.status === "merging").length;

  if (receiptCount === 0 && mergeCount === 0) return null;

  const parts: string[] = [];
  if (receiptCount > 0) parts.push(`${receiptCount} receipt${receiptCount > 1 ? "s" : ""}`);
  if (mergeCount > 0)   parts.push(`${mergeCount} merge${mergeCount > 1 ? "s" : ""}`);

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl" style={{ background: "var(--color-primary-fixed)" }}>
      <Spinner size={20} color="var(--color-primary-fixed-dim)" activeColor="var(--color-primary)" />
      <p style={{ fontSize: 14, color: "var(--color-primary)", fontWeight: 500 }}>
        {parts.join(" & ")} being processed by AI…
      </p>
    </div>
  );
}

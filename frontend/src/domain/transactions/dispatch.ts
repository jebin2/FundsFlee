import type { Transaction, TransactionSource } from "@/types";
import { receiptsApi } from "@/lib/api/receipts";

// Which sources have a background processor behind them. "email" and "merge"
// rows are written complete by the server and have nothing to re-run; asking
// the receipt processor to handle one only produces a 404 about a receipt URL
// that was never supposed to exist.
export function canProcess(source: TransactionSource): boolean {
  return source === "sms" || source === "manual" || source === "import" || source === "receipt";
}

// An email row cannot go through processTransaction: the row keeps only
// "subject | from", never the body, so a re-run has to fetch the mail again —
// and because one mail can hold several payments, it goes via a confirmation
// rather than straight through.
export function canRerunEmail(source: TransactionSource): boolean {
  return source === "email";
}

// The one place a transaction is routed to its processor. Both callers — the
// queued-row poller and the "Retry AI" button — come through here, because
// when they routed independently the button did not route at all.
export async function processTransaction(tx: Transaction, region: string): Promise<boolean> {
  if (tx.source === "sms" || tx.source === "manual") {
    await fetch(`/api/parse/text/process?txId=${tx.id}&region=${encodeURIComponent(region)}`, { method: "POST" });
  } else if (tx.source === "import") {
    await fetch(`/api/parse/statement/process?txId=${tx.id}`, { method: "POST" });
  } else if (tx.source === "receipt") {
    await receiptsApi.process(tx.id, region);
  } else {
    console.warn("[dispatch] transaction with no processor for source", {
      id: tx.id,
      source: tx.source,
    });
    return false;
  }
  return true;
}

// What to call a source in front of the user.
const SOURCE_LABELS: Record<TransactionSource, string> = {
  manual: "Manual entry",
  sms: "SMS",
  email: "Email",
  receipt: "Receipt",
  shortcut: "Shortcut",
  merge: "Merge",
  import: "Statement",
};

export function sourceLabel(source: TransactionSource): string {
  return SOURCE_LABELS[source] ?? "Transaction";
}

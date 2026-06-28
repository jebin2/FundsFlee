import { todayISO } from "@/lib/date/iso";
import type { Transaction } from "@/types";
import { encodeMergeMetadata } from "./metadata";

function basePlaceholder(id?: string): Pick<Transaction, "id" | "date" | "time" | "amount" | "category" | "payment_method" | "created_at" | "updated_at"> {
  const now = new Date().toISOString();
  return {
    id: id ?? crypto.randomUUID(),
    date: todayISO(),
    time: now.split("T")[1].slice(0, 5),
    amount: 0,
    category: "Others",
    payment_method: "Other",
    created_at: now,
    updated_at: now,
  };
}

export function createQueuedTextParseTransaction(text: string): Transaction {
  return {
    ...basePlaceholder(),
    merchant: "Parsing SMS…",
    source: "sms",
    status: "queued",
    raw_input: text.slice(0, 1000),
  };
}

export function createQueuedReceiptTransaction(receiptUrl: string, id?: string): Transaction {
  return {
    ...basePlaceholder(id),
    merchant: "Processing…",
    source: "receipt",
    status: "queued",
    receipt_url: receiptUrl,
  };
}

export function createQueuedStatementTransaction(receiptUrl: string): Transaction {
  return {
    ...basePlaceholder(),
    merchant: "Bank Statement",
    source: "import",
    status: "queued",
    receipt_url: receiptUrl,
  };
}

export function createMergePlaceholderTransaction(sourceIds: string[]): Transaction {
  return {
    ...basePlaceholder(),
    merchant: "Merging…",
    source: "merge",
    status: "merging",
    notes: encodeMergeMetadata(sourceIds),
  };
}

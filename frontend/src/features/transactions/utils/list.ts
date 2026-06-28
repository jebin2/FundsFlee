import type { Transaction } from "@/types";
import { toISODate, todayISO } from "@/lib/date/iso";

export type DatePreset = "week" | "month" | "year" | "custom" | "";

export interface TransactionListFilters {
  search: string;
  category: string;
  showDuplicatesOnly: boolean;
  datePreset: DatePreset;
  customFrom: string;
  customTo: string;
}

export interface DuplicateGroup {
  original: Transaction;
  duplicates: Transaction[];
}

export function groupTransactionsByDate(txs: Transaction[]): Record<string, Transaction[]> {
  const groups: Record<string, Transaction[]> = {};
  for (const tx of txs) {
    (groups[tx.date] ??= []).push(tx);
  }
  return groups;
}

export function getTransactionCategories(txs: Transaction[]): string[] {
  return [...new Set(txs.map((t) => t.category).filter((c) => c && c !== "Others"))].sort();
}

export function getDateFilterRange(
  datePreset: DatePreset,
  customFrom: string,
  customTo: string,
  now = new Date()
): { from: string; to: string } {
  if (datePreset === "custom") return { from: customFrom, to: customTo };
  if (!datePreset) return { from: "", to: "" };

  if (datePreset === "week") {
    const from = new Date(now);
    from.setDate(from.getDate() - from.getDay());
    return { from: toISODate(from), to: todayISO(now) };
  }

  if (datePreset === "month") {
    return {
      from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
      to: todayISO(now),
    };
  }

  return { from: `${now.getFullYear()}-01-01`, to: todayISO(now) };
}

export function filterAndSortTransactions(
  transactions: Transaction[],
  filters: TransactionListFilters,
  now = new Date()
): Transaction[] {
  const { from, to } = getDateFilterRange(filters.datePreset, filters.customFrom, filters.customTo, now);
  const query = filters.search.toLowerCase();

  const result: Transaction[] = [];
  for (const t of transactions) {
    if (filters.showDuplicatesOnly && !t.is_duplicate) continue;
    if (filters.category && t.category !== filters.category) continue;
    if (from && t.date < from) continue;
    if (to && t.date > to) continue;
    if (query && !(
      t.item_name?.toLowerCase().includes(query) ||
      t.merchant.toLowerCase().includes(query) ||
      t.category?.toLowerCase().includes(query) ||
      t.notes?.toLowerCase().includes(query)
    )) continue;
    result.push(t);
  }

  return result.sort((a, b) => {
    const aFlight = a.status === "queued" || a.status === "processing" ? 1 : 0;
    const bFlight = b.status === "queued" || b.status === "processing" ? 1 : 0;
    if (aFlight !== bFlight) return bFlight - aFlight;
    return b.date.localeCompare(a.date) || b.time.localeCompare(a.time);
  });
}

export function getDuplicateGroups(transactions: Transaction[]): DuplicateGroup[] {
  const groupMap: Record<string, Transaction[]> = {};
  for (const tx of transactions) {
    if (tx.is_duplicate && tx.duplicate_ref) {
      (groupMap[tx.duplicate_ref] ??= []).push(tx);
    }
  }

  return Object.entries(groupMap)
    .map(([originalId, duplicates]) => ({
      original: transactions.find((t) => t.id === originalId),
      duplicates,
    }))
    .filter((group): group is DuplicateGroup => Boolean(group.original));
}

export function formatTransactionDateLabel(date: string, now = new Date()): string {
  const currentDay = todayISO(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = toISODate(yesterdayDate);

  if (date === currentDay) return "Today";
  if (date === yesterday) return "Yesterday";
  return new Date(date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

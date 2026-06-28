import { create } from "zustand";
import type { Transaction } from "@/types";

interface TransactionsState {
  transactions: Transaction[];
  total: number;
  hasMore: boolean;
  syncing: boolean;
  loadingMore: boolean;
  setTransactions: (txs: Transaction[], total: number, hasMore: boolean) => void;
  mergeTransactions: (txs: Transaction[], total: number, hasMore: boolean) => void;
  addTransaction: (tx: Transaction) => void;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;
  removeTransaction: (id: string) => void;
  setSyncing: (syncing: boolean) => void;
  setLoadingMore: (loadingMore: boolean) => void;
}

export const useTransactionsStore = create<TransactionsState>((set) => ({
  transactions: [],
  total: 0,
  hasMore: false,
  syncing: false,
  loadingMore: false,

  // Replace entire list (initial load / full refresh)
  setTransactions: (transactions, total, hasMore) => set({ transactions, total, hasMore }),

  // Accumulate a new page into the existing list, deduplicating by id
  mergeTransactions: (incoming, total, hasMore) =>
    set((s) => {
      const existingIds = new Set(s.transactions.map((t) => t.id));
      const newOnes = incoming.filter((t) => !existingIds.has(t.id));
      return { transactions: [...s.transactions, ...newOnes], total, hasMore };
    }),

  addTransaction: (tx) => set((s) => ({ transactions: [tx, ...s.transactions], total: s.total + 1 })),

  // Caller is also responsible for updating IndexedDB via patchLocalTransaction()
  updateTransaction: (id, updates) =>
    set((s) => ({ transactions: s.transactions.map((t) => (t.id === id ? { ...t, ...updates } : t)) })),

  // Caller is also responsible for updating IndexedDB via removeLocalTransaction()
  removeTransaction: (id) =>
    set((s) => ({ transactions: s.transactions.filter((t) => t.id !== id), total: Math.max(0, s.total - 1) })),

  setSyncing: (syncing) => set({ syncing }),
  setLoadingMore: (loadingMore) => set({ loadingMore }),
}));

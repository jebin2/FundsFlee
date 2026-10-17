import { create } from "zustand";
import type { Transaction } from "@/types";

interface TransactionsState {
  transactions: Transaction[];
  total: number;
  syncing: boolean;
  setTransactions: (txs: Transaction[], total: number) => void;
  addTransaction: (tx: Transaction) => void;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;
  removeTransaction: (id: string) => void;
  setSyncing: (syncing: boolean) => void;
}

export const useTransactionsStore = create<TransactionsState>((set) => ({
  transactions: [],
  total: 0,
  syncing: false,

  // Replace entire list (initial load / full refresh)
  setTransactions: (transactions, total) => set({ transactions, total }),

  addTransaction: (tx) => set((s) => ({ transactions: [tx, ...s.transactions], total: s.total + 1 })),

  // Caller is also responsible for updating IndexedDB via patchLocalTransaction()
  updateTransaction: (id, updates) =>
    set((s) => ({ transactions: s.transactions.map((t) => (t.id === id ? { ...t, ...updates } : t)) })),

  // Caller is also responsible for updating IndexedDB via removeLocalTransaction()
  removeTransaction: (id) =>
    set((s) => ({ transactions: s.transactions.filter((t) => t.id !== id), total: Math.max(0, s.total - 1) })),

  setSyncing: (syncing) => set({ syncing }),
}));

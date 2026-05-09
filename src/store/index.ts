import { create } from "zustand";
import type { Transaction, Category, UserProfile } from "@/types";

interface AppState {
  transactions: Transaction[];
  categories: Category[];
  profile: UserProfile | null;
  isOnline: boolean;
  pendingCount: number;
  syncing: boolean;

  setTransactions: (txs: Transaction[]) => void;
  addTransaction: (tx: Transaction) => void;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;
  removeTransaction: (id: string) => void;
  setCategories: (cats: Category[]) => void;
  setProfile: (profile: UserProfile) => void;
  setOnline: (online: boolean) => void;
  setPendingCount: (count: number) => void;
  setSyncing: (syncing: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  transactions: [],
  categories: [],
  profile: null,
  isOnline: true,
  pendingCount: 0,
  syncing: false,

  setTransactions: (transactions) => set({ transactions }),

  addTransaction: (tx) =>
    set((s) => ({ transactions: [tx, ...s.transactions] })),

  // Caller is responsible for also updating IndexedDB via patchLocalTransaction()
  updateTransaction: (id, updates) =>
    set((s) => ({
      transactions: s.transactions.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    })),

  // Caller is responsible for also updating IndexedDB via removeLocalTransaction()
  removeTransaction: (id) =>
    set((s) => ({
      transactions: s.transactions.filter((t) => t.id !== id),
    })),

  setCategories: (categories) => set({ categories }),
  setProfile: (profile) => set({ profile }),
  setOnline: (isOnline) => set({ isOnline }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setSyncing: (syncing) => set({ syncing }),
}));

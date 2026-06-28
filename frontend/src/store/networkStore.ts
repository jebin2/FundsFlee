import { create } from "zustand";

interface NetworkState {
  isOnline: boolean;
  pendingCount: number;
  conflictCount: number;
  setOnline: (online: boolean) => void;
  setPendingCount: (count: number) => void;
  setConflictCount: (count: number) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  isOnline: true,
  pendingCount: 0,
  conflictCount: 0,
  setOnline: (isOnline) => set({ isOnline }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setConflictCount: (conflictCount) => set({ conflictCount }),
}));

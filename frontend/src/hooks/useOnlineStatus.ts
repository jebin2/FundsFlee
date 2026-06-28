"use client";

import { useNetworkStore } from "@/store/networkStore";

export function useOnlineStatus() {
  return useNetworkStore((s) => s.isOnline);
}

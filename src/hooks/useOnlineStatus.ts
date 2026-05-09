"use client";

import { useAppStore } from "@/store";

export function useOnlineStatus() {
  return useAppStore((s) => s.isOnline);
}

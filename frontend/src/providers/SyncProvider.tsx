"use client";

import { useSyncEffect } from "./useSyncEffect";

export function SyncProvider({ children }: { children: React.ReactNode }) {
  useSyncEffect();
  return <>{children}</>;
}

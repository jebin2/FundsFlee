"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { TopNav } from "@/components/layout/TopNav";
import { BottomNav } from "@/components/layout/BottomNav";
import { FAB } from "@/components/layout/FAB";
import { PullToRefresh } from "@/components/layout/PullToRefresh";
import { SyncProvider } from "@/providers/SyncProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useFetchInterceptor } from "@/hooks/useFetchInterceptor";
import { useTransactionsStore } from "@/store/transactionsStore";
import { useNetworkStore } from "@/store/networkStore";
import { pullTransactions } from "@/lib/offline";
import { useCallback } from "react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const signingOut = useRef(false);

  function triggerSignOut() {
    if (signingOut.current) return;
    signingOut.current = true;
    signOut({ callbackUrl: "/" });
  }

  useFetchInterceptor(triggerSignOut);

  // Reload when a new service worker activates so stale JS bundles
  // (which carry old Server Action IDs) are never used against the new build.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const reload = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", reload);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", reload);
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    if (session?.error === "RefreshTokenError") triggerSignOut();
  }, [session?.error]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: "var(--color-background)" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
            style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
          <p style={{ color: "var(--color-on-surface-variant)", fontSize: 14 }}>Loading…</p>
        </div>
      </div>
    );
  }

  // Show spinner while redirect to "/" is in progress — prevents blank white page
  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: "var(--color-background)" }}>
        <div className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
          style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
      </div>
    );
  }

  return (
    <SyncProvider>
      <ErrorBoundary>
        <AppShell session={session}>{children}</AppShell>
      </ErrorBoundary>
    </SyncProvider>
  );
}

function AppShell({
  session,
  children,
}: {
  session: NonNullable<ReturnType<typeof useSession>["data"]>;
  children: React.ReactNode;
}) {
  const isOnline = useOnlineStatus();
  const pendingCount = useNetworkStore((s) => s.pendingCount);
  const conflictCount = useNetworkStore((s) => s.conflictCount);
  const setConflictCount = useNetworkStore((s) => s.setConflictCount);
  const setTransactions = useTransactionsStore((s) => s.setTransactions);

  const handleRefresh = useCallback(async () => {
    // 1. Check for new service worker (gets latest JS/HTML/CSS)
    if ("serviceWorker" in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          // If a new SW is already waiting, activate it and reload
          if (reg.waiting) {
            reg.waiting.postMessage({ type: "SKIP_WAITING" });
            navigator.serviceWorker.addEventListener("controllerchange", () => {
              window.location.reload();
            }, { once: true });
            return;
          }
        }
      } catch {
        // SW not available — continue
      }
    }
    // 2. Pull latest transaction data
    try {
      const { transactions: txs, total, hasMore } = await pullTransactions(1);
      setTransactions(txs, total, hasMore);
    } catch {
      // Network unavailable — silently ignore
    }
  }, [setTransactions]);

  return (
    <div style={{ minHeight: "100dvh", background: "var(--color-background)" }}>
      <TopNav userName={session.user?.name ?? ""} userImage={session.user?.image ?? ""} />

      {/* Conflict banner — shown when offline ops failed to apply */}
      {conflictCount > 0 && isOnline && pendingCount === 0 && (
        <div className="fixed top-0 md:top-16 left-0 w-full z-40 flex items-center justify-center gap-2 py-1.5"
          style={{ background: "var(--color-error-container)", color: "var(--color-on-error-container)", fontSize: 13, fontWeight: 500 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>warning</span>
          {`${conflictCount} offline change${conflictCount > 1 ? "s" : ""} couldn't be applied`}
          <button onClick={() => setConflictCount(0)} className="ml-2 underline" style={{ fontSize: 12 }}>Dismiss</button>
        </div>
      )}

      {/* Status banner — offline or syncing pending ops */}
      {(!isOnline || pendingCount > 0) && (
        <div
          className="fixed top-0 md:top-16 left-0 w-full z-40 flex items-center justify-center gap-2 py-1.5"
          style={{
            background: !isOnline ? "#37474f" : "var(--color-secondary-container)",
            color: !isOnline ? "#fff" : "var(--color-on-secondary-container)",
            fontSize: 13,
            fontWeight: 500,
          }}>
          {!isOnline ? (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>wifi_off</span>
              {pendingCount > 0 ? `Offline · ${pendingCount} pending` : "Offline · viewing cached data"}
            </>
          ) : (
            <>
              <div className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: "var(--color-secondary)", borderTopColor: "var(--color-on-secondary-container)" }} />
              {`Syncing ${pendingCount} pending…`}
            </>
          )}
        </div>
      )}

      {/*
        Padding logic:
        - Online  mobile:  pt-0   (no TopNav on mobile)
        - Online  desktop: pt-20  (64px TopNav)
        - Offline mobile:  pt-8   (32px banner)
        - Offline desktop: pt-24  (64px TopNav + ~32px banner)
      */}
      {/* Mobile: pt-8 only when banner is visible (offline/pending); desktop always pt-24 for TopNav+banner */}
      <PullToRefresh onRefresh={handleRefresh}>
        <main style={{ paddingBottom: 96 }} className={`${!isOnline || pendingCount > 0 ? "pt-8" : ""} md:pt-24`}>
          {children}
        </main>
      </PullToRefresh>

      <BottomNav />
      <FAB />
    </div>
  );
}

"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { TopNav } from "@/components/layout/TopNav";
import { BottomNav } from "@/components/layout/BottomNav";
import { FAB } from "@/components/layout/FAB";
import { SyncProvider } from "@/providers/SyncProvider";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useAppStore } from "@/store";

// Module-level guard — prevents double-wrapping fetch in React StrictMode dev
let fetchIntercepted = false;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const signingOut = useRef(false);

  function triggerSignOut() {
    if (signingOut.current) return;
    signingOut.current = true;
    signOut({ callbackUrl: "/" });
  }

  useEffect(() => {
    if (fetchIntercepted) return;
    fetchIntercepted = true;

    const original = window.fetch;
    window.fetch = async (...args) => {
      const res = await original(...args);
      const url = typeof args[0] === "string" ? args[0] : args[0]?.toString?.() ?? "";
      if (res.status === 401 && url.startsWith("/api/")) {
        triggerSignOut();
      }
      return res;
    };

    return () => {
      // Only restore if we were the ones who wrapped
      window.fetch = original;
      fetchIntercepted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    if (session?.error === "RefreshTokenError") triggerSignOut();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (!session) return null;

  return (
    <SyncProvider>
      <AppShell session={session}>{children}</AppShell>
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
  const pendingCount = useAppStore((s) => s.pendingCount);

  return (
    <div style={{ minHeight: "100dvh", background: "var(--color-background)" }}>
      <TopNav userName={session.user?.name ?? ""} userImage={session.user?.image ?? ""} />

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
      {/* Always reserve space for both TopNav + potential banner to prevent layout shift */}
      <main style={{ paddingBottom: 96 }} className="pt-8 md:pt-24">
        {children}
      </main>

      <BottomNav />
      <FAB />
    </div>
  );
}

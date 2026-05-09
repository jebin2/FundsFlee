"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { TopNav } from "@/components/layout/TopNav";
import { BottomNav } from "@/components/layout/BottomNav";
import { FAB } from "@/components/layout/FAB";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const signingOut = useRef(false);

  function triggerSignOut() {
    if (signingOut.current) return;
    signingOut.current = true;
    signOut({ callbackUrl: "/" });
  }

  // Intercept 401 responses from our own API — fires signOut immediately
  // regardless of whether the JWT refresh cycle has caught up yet.
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const res = await original(...args);
      const url = typeof args[0] === "string" ? args[0] : args[0]?.toString?.() ?? "";
      if (res.status === 401 && url.startsWith("/api/")) {
        triggerSignOut();
      }
      return res;
    };
    return () => { window.fetch = original; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/");
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.error === "RefreshTokenError") {
      triggerSignOut();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.error]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: "var(--color-background)" }}>
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
            style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }}
          />
          <p style={{ color: "var(--color-on-surface-variant)", fontSize: 14 }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div style={{ minHeight: "100dvh", background: "var(--color-background)" }}>
      <TopNav userName={session.user?.name ?? ""} userImage={session.user?.image ?? ""} />
      <main style={{ paddingBottom: 96 }} className="md:pt-20">
        {children}
      </main>
      <BottomNav />
      <FAB />
    </div>
  );
}

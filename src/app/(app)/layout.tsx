"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { TopNav } from "@/components/layout/TopNav";
import { BottomNav } from "@/components/layout/BottomNav";
import { FAB } from "@/components/layout/FAB";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/");
    }
  }, [status, router]);

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

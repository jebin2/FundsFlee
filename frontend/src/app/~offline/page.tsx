"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function OfflinePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  // Auto-redirect once connection is restored
  useEffect(() => {
    const handleOnline = () => {
      setChecking(true);
      window.location.replace("/dashboard");
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh gap-6 px-6 text-center"
      style={{ background: "var(--color-background)" }}>
      <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
        style={{ background: "var(--color-surface-container)" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 40, color: "var(--color-outline)" }}>wifi_off</span>
      </div>
      <div>
        <p style={{ fontSize: 20, fontWeight: 700, color: "var(--color-on-surface)" }} className="mb-2">
          You&apos;re offline
        </p>
        <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)", maxWidth: 260 }}>
          No internet connection. Your data is saved locally and will sync when you reconnect.
        </p>
      </div>
      <button
        onClick={() => { setChecking(true); window.location.replace("/dashboard"); }}
        disabled={checking}
        className="px-6 py-3 rounded-2xl font-semibold flex items-center gap-2"
        style={{ background: "var(--color-primary)", color: "#fff", opacity: checking ? 0.6 : 1 }}>
        {checking
          ? <><div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />Connecting…</>
          : <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>Try again</>}
      </button>
    </div>
  );
}

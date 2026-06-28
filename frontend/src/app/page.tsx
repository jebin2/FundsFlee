"use client";

import { useSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LandingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      const path = window.location.pathname;
      router.replace(path === "/" ? "/dashboard" : path);
    }
  }, [status, router]);

  if (status === "loading" || session) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: "var(--color-background)" }}>
        <div
          className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
          style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }}
        />
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ background: "linear-gradient(160deg, #1f108e 0%, #3730a3 45%, #6063ee 100%)" }}>
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-8 pb-4 text-center min-h-0">
        <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-4" style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(10px)" }}>
          <span className="material-symbols-outlined text-white" style={{ fontSize: 32, fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
        </div>

        <h1 style={{ fontSize: 28, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1.2 }} className="mb-2">
          FundsFlee
        </h1>
        <p style={{ fontSize: 15, color: "rgba(255,255,255,0.8)" }} className="mb-6">
          Your AI spending agent
        </p>

        <div className="flex flex-col gap-3 w-full max-w-xs">
          {[
            { icon: "psychology", text: "AI parses SMS, emails & receipts automatically" },
            { icon: "table_chart", text: "Your data lives in your own Google Sheet" },
            { icon: "location_on", text: "Region-aware tips (Chennai, Mumbai, Delhi…)" },
          ].map(({ icon, text }) => (
            <div key={icon} className="flex items-center gap-3 text-left">
              <div className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.15)" }}>
                <span className="material-symbols-outlined text-white" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
              </div>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>{text}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="px-6 pb-8 flex-shrink-0">
        <div className="rounded-3xl p-5 max-w-sm mx-auto" style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.2)" }}>
          <p className="text-center mb-3" style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
            Sign in to get started — it&apos;s free
          </p>
          <button
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
            className="w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl font-semibold transition-transform active:scale-95"
            style={{ background: "#fff", color: "#1f108e", fontSize: 15, boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign in with Google
          </button>
          <p className="text-center mt-2" style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
            Requires Google Sheets access · Data stays in your Drive
          </p>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { usePushSubscription } from "@/hooks/usePushSubscription";

export default function SettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [showReset, setShowReset] = useState(false);
  const push = usePushSubscription();
  const [confirmText, setConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function refreshApp() {
    if (!confirm("Clear all cached files and reload the latest version of the app?")) return;
    setRefreshing(true);
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.update()));
      }
      window.location.reload();
    } catch {
      setRefreshing(false);
      alert("Refresh failed — please reload manually.");
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (!res.ok) throw new Error("Reset failed");
      setShowReset(false);
      router.push("/dashboard");
    } finally {
      setResetting(false);
    }
  }

  const settingGroups = [
    {
      title: "Account & Data",
      items: [
        { icon: "person", label: "Profile & Location", sub: "Name, city, lifestyle tags", href: "/settings/profile" },
        { icon: "table_chart", label: "Google Sheet", sub: "View sheet, sync status", href: "/settings/sheet" },
        { icon: "ios_share", label: "iPhone Shortcut", sub: "Auto-log from SMS share", href: "/settings/shortcut" },
        { icon: "download", label: "Data & Export", sub: "Export CSV, clear cache", href: "/settings/data" },
        { icon: "picture_as_pdf", label: "Import Statement", sub: "Upload bank PDF — AI extracts all transactions", href: "/import" },
        { icon: "mark_email_read", label: "Email Import", sub: "Auto-import transactions from Gmail daily", href: "/settings/email" },
        { icon: "schedule", label: "Scheduled Tasks", sub: "Daily email import & duplicate check at 12:00 PM", href: "/settings/scheduled" },
      ],
    },
    {
      title: "AI & Analysis",
      items: [
        { icon: "analytics", label: "Analysis", sub: "View AI insights", href: "/analysis" },
        { icon: "compare_arrows", label: "Compare prices", sub: "AI-powered merchant comparison", href: "/analysis?tab=compare" },
        { icon: "category", label: "Categories", sub: "Manage spending categories", href: "/categories" },
      ],
    },
  ];

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6 pb-8 flex flex-col gap-5">
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-on-background)" }}>Settings</h1>

      {/* Profile card */}
      <div className="rounded-3xl p-5 border flex items-center gap-4" style={{ background: "var(--color-surface-container-lowest)", borderColor: "var(--color-outline-variant)", boxShadow: "0 4px 12px rgba(31,16,142,0.06)" }}>
        {session?.user?.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.user.image} alt="" className="w-16 h-16 rounded-2xl object-cover border-2" style={{ borderColor: "var(--color-outline-variant)" }} />
        )}
        <div>
          <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-on-surface)" }}>{session?.user?.name}</p>
          <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{session?.user?.email}</p>
        </div>
      </div>

      {/* Setting groups */}
      {settingGroups.map((group) => (
        <div key={group.title}>
          <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }} className="px-1 mb-2">
            {group.title}
          </p>
          <div className="rounded-3xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
            {group.items.map((item, i) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-4 px-5 py-4 transition-colors"
                style={{ borderBottom: i < group.items.length - 1 ? "1px solid var(--color-surface-variant)" : "none" }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--color-primary-fixed)" }}>
                  <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20 }}>{item.icon}</span>
                </div>
                <div className="flex-1">
                  <p style={{ fontSize: 15, fontWeight: 500, color: "var(--color-on-surface)" }}>{item.label}</p>
                  <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>{item.sub}</p>
                </div>
                <span className="material-symbols-outlined" style={{ color: "var(--color-outline)", fontSize: 20 }}>chevron_right</span>
              </Link>
            ))}
          </div>
        </div>
      ))}

      {/* Notifications */}
      {push.supported && (
        <div>
          <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }} className="px-1 mb-2">Notifications</p>
          <div className="rounded-3xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
            <div className="flex items-center gap-4 px-5 py-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--color-primary-fixed)" }}>
                <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontSize: 20 }}>notifications</span>
              </div>
              <div className="flex-1">
                <p style={{ fontSize: 15, fontWeight: 500, color: "var(--color-on-surface)" }}>Receipt notifications</p>
                <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>
                  {push.subscribed ? "Notify me when a receipt is processed" : "Get notified when receipts finish processing"}
                </p>
              </div>
              <button
                onClick={push.subscribed ? push.unsubscribe : push.subscribe}
                disabled={push.loading}
                className="px-4 py-2 rounded-xl font-medium text-sm"
                style={{
                  background: push.subscribed ? "var(--color-error-container)" : "var(--color-primary)",
                  color: push.subscribed ? "var(--color-error)" : "var(--color-on-primary)",
                  opacity: push.loading ? 0.6 : 1,
                }}>
                {push.loading ? "…" : push.subscribed ? "Turn off" : "Turn on"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sign out + version */}
      <div>
        <p style={{ fontSize: 12, color: "var(--color-outline)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }} className="px-1 mb-2">Danger Zone</p>
        <div className="rounded-3xl overflow-hidden border" style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
          <button
            onClick={refreshApp}
            disabled={refreshing}
            className="w-full flex items-center gap-4 px-5 py-4 text-left"
            style={{ borderBottom: "1px solid var(--color-surface-variant)", opacity: refreshing ? 0.6 : 1 }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--color-error-container)" }}>
              {refreshing
                ? <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(0,0,0,0.1)", borderTopColor: "var(--color-error)" }} />
                : <span className="material-symbols-outlined" style={{ color: "var(--color-error)", fontSize: 20 }}>system_update</span>
              }
            </div>
            <div className="flex-1">
              <p style={{ fontSize: 15, fontWeight: 500, color: "var(--color-error)" }}>Refresh App</p>
              <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>Clear cached files and load the latest version</p>
            </div>
          </button>
          <button
            onClick={() => { setShowReset(true); setConfirmText(""); }}
            className="w-full flex items-center gap-4 px-5 py-4 text-left"
            style={{ borderBottom: "1px solid var(--color-surface-variant)" }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--color-error-container)" }}>
              <span className="material-symbols-outlined" style={{ color: "var(--color-error)", fontSize: 20 }}>delete_forever</span>
            </div>
            <div className="flex-1">
              <p style={{ fontSize: 15, fontWeight: 500, color: "var(--color-error)" }}>Reset all data</p>
              <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>Permanently delete all transactions</p>
            </div>
          </button>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="w-full flex items-center gap-4 px-5 py-4 text-left"
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--color-error-container)" }}>
              <span className="material-symbols-outlined" style={{ color: "var(--color-error)", fontSize: 20 }}>logout</span>
            </div>
            <p style={{ fontSize: 15, fontWeight: 500, color: "var(--color-error)" }}>Sign out</p>
          </button>
        </div>
      </div>

      {/* Reset confirmation modal */}
      {showReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-5"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
          onClick={() => setShowReset(false)}>
          <div className="w-full max-w-sm rounded-3xl p-6 flex flex-col gap-4"
            style={{ background: "var(--color-surface)", boxShadow: "0 24px 48px rgba(0,0,0,0.2)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto"
              style={{ background: "var(--color-error-container)" }}>
              <span className="material-symbols-outlined" style={{ color: "var(--color-error)", fontSize: 28 }}>delete_forever</span>
            </div>
            <div className="text-center">
              <p style={{ fontSize: 18, fontWeight: 700, color: "var(--color-on-surface)" }}>Reset all data?</p>
              <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)", marginTop: 6 }}>
                This will permanently delete all transactions, suggestions, and analysis. Categories will be reset to defaults. This cannot be undone.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>
                Type <strong>RESET</strong> to confirm
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="RESET"
                autoFocus
                className="px-4 py-3 rounded-xl border outline-none text-center font-semibold tracking-widest"
                style={{
                  borderColor: confirmText === "RESET" ? "var(--color-error)" : "var(--color-outline-variant)",
                  background: "var(--color-surface-container)",
                  color: "var(--color-on-surface)",
                  fontSize: 16,
                }}
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowReset(false)} className="flex-1 py-3 rounded-2xl font-semibold"
                style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface-variant)", fontSize: 15 }}>
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={confirmText !== "RESET" || resetting}
                className="flex-1 py-3 rounded-2xl font-semibold flex items-center justify-center gap-2"
                style={{
                  background: "var(--color-error)",
                  color: "#fff",
                  fontSize: 15,
                  opacity: confirmText !== "RESET" || resetting ? 0.4 : 1,
                }}>
                {resetting
                  ? <><div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(255,255,255,0.4)", borderTopColor: "#fff" }} />Resetting…</>
                  : <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete_forever</span>Reset</>}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-center" style={{ fontSize: 12, color: "var(--color-outline)" }}>FundsFlee v1.0.0 · Built with Claude claude-sonnet-4-6</p>
    </div>
  );
}

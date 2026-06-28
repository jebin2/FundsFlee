"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";

export function FAB() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  if (pathname === "/add" || pathname.startsWith("/capture")) return null;

  const options = [
    { icon: "edit_note", label: "Enter manually", sub: "Type in the details", href: "/add" },
    { icon: "photo_camera", label: "Capture receipt", sub: "Photo or gallery", href: "/capture?tab=camera" },
    { icon: "content_paste", label: "Paste SMS / Email", sub: "Any payment notification", href: "/capture?tab=paste" },
  ];

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
          onClick={() => setOpen(false)}
        />
      )}

      {open && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl"
          style={{ background: "var(--color-surface-container-lowest)", boxShadow: "0 -8px 40px rgba(0,0,0,0.15)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full" style={{ background: "var(--color-outline-variant)" }} />
          </div>
          <p className="text-center font-semibold py-3" style={{ fontSize: 20, color: "var(--color-on-background)" }}>
            Add Spending
          </p>
          <div className="px-5 pb-6 flex flex-col gap-2">
            {options.map((opt) => (
              <button
                key={opt.href}
                onClick={() => { setOpen(false); router.push(opt.href); }}
                className="flex items-center gap-4 p-4 rounded-2xl w-full text-left transition-colors hover:opacity-90"
                style={{ background: "var(--color-surface-container-low)" }}
              >
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: "var(--color-primary)" }}>
                  <span className="material-symbols-outlined" style={{ color: "var(--color-on-primary)", fontSize: 22 }}>{opt.icon}</span>
                </div>
                <div className="flex-1">
                  <p className="font-medium" style={{ color: "var(--color-on-surface)" }}>{opt.label}</p>
                  <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>{opt.sub}</p>
                </div>
                <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>chevron_right</span>
              </button>
            ))}
            <a
              href="/settings/shortcut"
              className="flex items-center justify-center gap-2 py-3"
              style={{ color: "var(--color-on-surface-variant)", fontSize: 14 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>ios_share</span>
              Or set up auto-log from iPhone →
            </a>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        className="md:hidden fixed bottom-24 right-5 z-30 w-14 h-14 rounded-full flex items-center justify-center transition-transform active:scale-95"
        style={{
          background: "var(--color-primary)",
          color: "var(--color-on-primary)",
          boxShadow: "0 8px 20px rgba(31,16,142,0.3)",
          marginBottom: "env(safe-area-inset-bottom, 0px)",
        }}
        aria-label="Add spending"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 28 }}>
          {open ? "close" : "add"}
        </span>
      </button>
    </>
  );
}

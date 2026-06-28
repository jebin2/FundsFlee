"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, useRef, useEffect } from "react";

const links = [
  { href: "/dashboard", label: "Home" },
  { href: "/transactions", label: "Transactions" },
  { href: "/analysis", label: "Analytics" },
  { href: "/settings", label: "Settings" },
];

export function TopNav({ userName, userImage }: { userName?: string; userImage?: string }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  return (
    <header
      className="hidden md:flex fixed top-0 left-0 w-full justify-between items-center px-8 h-16 z-40 border-b"
      style={{
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(12px)",
        borderColor: "var(--color-outline-variant)",
      }}
    >
      <Link href="/dashboard" style={{ fontSize: 20, fontWeight: 700, color: "var(--color-primary)" }}>
        FundsFlee
      </Link>

      <nav className="flex items-center gap-1 text-sm font-medium" style={{ color: "var(--color-on-surface-variant)" }}>
        {links.map(({ href, label }) => {
          const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className="px-3 py-2 rounded-lg transition-colors"
              style={isActive ? { color: "var(--color-primary)", fontWeight: 600, background: "var(--color-primary-fixed)" } : {}}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-3">
        {userImage && (
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="hover:opacity-80 transition-opacity"
              title={userName}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={userImage} alt={userName ?? "User"} className="w-8 h-8 rounded-full object-cover border" style={{ borderColor: "var(--color-outline-variant)" }} />
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-52 rounded-2xl border shadow-lg overflow-hidden"
                style={{ background: "var(--color-surface)", borderColor: "var(--color-outline-variant)", zIndex: 50 }}
              >
                {/* User info */}
                <div className="px-4 py-3 border-b" style={{ borderColor: "var(--color-surface-variant)" }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-on-surface)" }} className="truncate">{userName}</p>
                </div>
                {/* Settings */}
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 transition-colors"
                  style={{ borderBottom: "1px solid var(--color-surface-variant)", color: "var(--color-on-surface)", fontSize: 14 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--color-on-surface-variant)" }}>settings</span>
                  Settings
                </Link>
                {/* Sign out */}
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                  style={{ color: "var(--color-error)", fontSize: 14 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>logout</span>
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

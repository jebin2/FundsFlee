"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const links = [
  { href: "/dashboard", label: "Home" },
  { href: "/transactions", label: "Transactions" },
  { href: "/analysis", label: "Analytics" },
  { href: "/settings", label: "Settings" },
];

export function TopNav({ userName, userImage }: { userName?: string; userImage?: string }) {
  const pathname = usePathname();

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
        SpendingTracker
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
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="hover:opacity-80 transition-opacity"
            title={`Sign out (${userName})`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={userImage} alt={userName ?? "User"} className="w-8 h-8 rounded-full object-cover border" style={{ borderColor: "var(--color-outline-variant)" }} />
          </button>
        )}
      </div>
    </header>
  );
}

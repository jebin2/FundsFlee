"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", icon: "home", label: "Home" },
  { href: "/transactions", icon: "receipt_long", label: "Spend" },
  { href: "/add", icon: "add_circle", label: "Add" },
  { href: "/analysis", icon: "analytics", label: "Analysis" },
  { href: "/settings", icon: "person", label: "Profile" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 w-full flex justify-around items-center h-20 px-4 z-50 rounded-t-3xl border-t"
      style={{
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(15px)",
        borderColor: "var(--color-outline-variant)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {links.map(({ href, icon, label }) => {
        const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-0.5 min-w-[48px]"
            style={{ color: isActive ? "var(--color-primary)" : "var(--color-outline)" }}
          >
            <span
              className="material-symbols-outlined text-2xl"
              style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}
            >
              {icon}
            </span>
            <span style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

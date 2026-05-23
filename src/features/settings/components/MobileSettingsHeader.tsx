"use client";

import { useRouter } from "next/navigation";

interface MobileSettingsHeaderProps {
  title: string;
}

export function MobileSettingsHeader({ title }: MobileSettingsHeaderProps) {
  const router = useRouter();
  return (
    <div className="md:hidden sticky top-0 z-30 flex items-center pt-10 pb-3 gap-3"
      style={{ background: "var(--color-background)" }}>
      <button
        onClick={() => router.back()}
        className="w-9 h-9 flex items-center justify-center rounded-xl"
        style={{ background: "var(--color-surface-container)" }}>
        <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>arrow_back</span>
      </button>
      <h1 className="font-semibold" style={{ fontSize: 20 }}>{title}</h1>
    </div>
  );
}

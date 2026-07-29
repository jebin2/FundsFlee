"use client";

import { useState } from "react";
import type { PresetGroup } from "@/features/settings/emailFilterPresets";

interface FilterPresetsProps {
  groups: PresetGroup[];
  already: string[];
  onAdd: (value: string) => void;
}

/**
 * Tap-to-add suggestions. Anything already on the list disappears from here, so
 * what remains is only what you can actually add — and a group that empties out
 * hides itself rather than leaving a dangling heading.
 */
export function FilterPresets({ groups, already, onAdd }: FilterPresetsProps) {
  const [open, setOpen] = useState(false);

  const remaining = groups
    .map((g) => ({ ...g, values: g.values.filter((v) => !already.includes(v)) }))
    .filter((g) => g.values.length > 0);

  if (remaining.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 self-start"
        style={{ fontSize: 12, fontWeight: 600, color: "var(--color-primary)" }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          {open ? "expand_less" : "expand_more"}
        </span>
        {open ? "Hide suggestions" : "Suggestions"}
      </button>

      {open && remaining.map((group) => (
        <div key={group.label} className="flex flex-col gap-1.5">
          <p style={{
            fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
            textTransform: "uppercase", color: "var(--color-outline)",
          }}>
            {group.label}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.values.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onAdd(value)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full"
                style={{
                  fontSize: 12,
                  background: "var(--color-surface-container)",
                  color: "var(--color-on-surface-variant)",
                  border: "1px solid var(--color-outline-variant)",
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>add</span>
                {value}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

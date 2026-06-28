import { memo } from "react";
import type { DatePreset } from "@/features/transactions/utils/list";

interface TransactionFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  filterCat: string;
  onCatChange: (v: string) => void;
  showDupsOnly: boolean;
  onDupsToggle: () => void;
  dupChecking: boolean;
  datePreset: DatePreset;
  onDatePresetChange: (p: DatePreset | "") => void;
  customFrom: string;
  onCustomFromChange: (v: string) => void;
  customTo: string;
  onCustomToChange: (v: string) => void;
  categories: string[];
}

export const TransactionFilters = memo(function TransactionFilters({
  search, onSearchChange,
  filterCat, onCatChange,
  showDupsOnly, onDupsToggle, dupChecking,
  datePreset, onDatePresetChange,
  customFrom, onCustomFromChange,
  customTo, onCustomToChange,
  categories,
}: TransactionFiltersProps) {
  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl" style={{ background: "var(--color-surface-container)" }}>
        <span className="material-symbols-outlined" style={{ color: "var(--color-outline)", fontSize: 20 }}>search</span>
        <input
          type="text"
          placeholder="Search merchants, categories…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 bg-transparent focus:outline-none"
          style={{ fontSize: 15, color: "var(--color-on-surface)" }}
        />
        {search && (
          <button onClick={() => onSearchChange("")}>
            <span className="material-symbols-outlined" style={{ color: "var(--color-outline)", fontSize: 18 }}>close</span>
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 pt-1">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["week", "month", "year", "custom"] as const).map((p) => (
            <button
              key={p}
              onClick={() => onDatePresetChange(datePreset === p ? "" : p)}
              className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium"
              style={{
                background: datePreset === p ? "var(--color-secondary-container)" : "var(--color-surface-container)",
                color: datePreset === p ? "var(--color-on-secondary-container)" : "var(--color-on-surface-variant)",
              }}
            >
              {p === "week" ? "This week" : p === "month" ? "This month" : p === "year" ? "This year" : "Custom"}
            </button>
          ))}
        </div>
        {datePreset === "custom" && (
          <div className="flex items-center gap-2 px-1">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => onCustomFromChange(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl text-sm focus:outline-none"
              style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", border: "1px solid var(--color-outline-variant)" }}
            />
            <span style={{ color: "var(--color-outline)", fontSize: 13 }}>to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => onCustomToChange(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl text-sm focus:outline-none"
              style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", border: "1px solid var(--color-outline-variant)" }}
            />
          </div>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={onDupsToggle}
          className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium flex items-center gap-1.5"
          style={{
            background: showDupsOnly ? "#fff3e0" : "var(--color-surface-container)",
            color: showDupsOnly ? "#e65100" : "var(--color-on-surface-variant)",
            border: showDupsOnly ? "1px solid #ffe0b2" : "none",
          }}
        >
          {dupChecking ? (
            <>
              <div className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#ffcc80", borderTopColor: "#e65100" }} />
              Checking…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>warning</span>
              Duplicates
            </>
          )}
        </button>
        <button
          onClick={() => onCatChange("")}
          className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium"
          style={{
            background: !filterCat ? "var(--color-primary)" : "var(--color-surface-container)",
            color: !filterCat ? "#fff" : "var(--color-on-surface-variant)",
          }}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => onCatChange(cat === filterCat ? "" : cat)}
            className="flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium"
            style={{
              background: filterCat === cat ? "var(--color-primary)" : "var(--color-surface-container)",
              color: filterCat === cat ? "#fff" : "var(--color-on-surface-variant)",
            }}
          >
            {cat}
          </button>
        ))}
      </div>
    </>
  );
});

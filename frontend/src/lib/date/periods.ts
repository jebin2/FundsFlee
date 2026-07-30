import { toISODate } from "./iso";

export type Period = "week" | "month" | "year" | "all";

// Earlier than any transaction this app can hold, so "all" needs no lower
// bound while still comparing as a plain ISO string like every other range.
const BEGINNING_OF_TIME = "1970-01-01";

export interface PeriodRange {
  from: string;
  to: string;
  label: string;
}

export function getPeriodRange(period: Period | string, now = new Date()): PeriodRange {
  const to = toISODate(now);

  if (period === "all") {
    return { from: BEGINNING_OF_TIME, to, label: "All time" };
  }

  if (period === "week") {
    const from = new Date(now);
    from.setDate(now.getDate() - 7);
    return { from: toISODate(from), to, label: "Last 7 days" };
  }

  if (period === "year") {
    return {
      from: toISODate(new Date(now.getFullYear(), 0, 1)),
      to,
      label: `Year ${now.getFullYear()}`,
    };
  }

  return {
    from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to,
    label: now.toLocaleString("en-IN", { month: "long", year: "numeric" }),
  };
}

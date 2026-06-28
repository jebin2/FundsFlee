import { toISODate } from "./iso";

export type Period = "week" | "month" | "year";

export interface PeriodRange {
  from: string;
  to: string;
  label: string;
}

export function getPeriodRange(period: Period | string, now = new Date()): PeriodRange {
  const to = toISODate(now);

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

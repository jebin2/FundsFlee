"use client";

import { useMemo } from "react";
import { todayISO, toISODate } from "@/lib/date/iso";
import type { Transaction, RecurrencePeriod } from "@/types";

function nextDueDate(lastDate: string, period: RecurrencePeriod): string {
  const d = new Date(lastDate + "T00:00:00");
  switch (period) {
    case "daily":   d.setDate(d.getDate() + 1); break;
    case "weekly":  d.setDate(d.getDate() + 7); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "yearly":  d.setFullYear(d.getFullYear() + 1); break;
  }
  return toISODate(d);
}

export interface DueRecurring {
  template: Transaction;
  dueDate: string;
  overdueDays: number;
}

// Returns recurring transactions whose next due date is today or past.
// Groups by merchant+category (template identity) and picks the most recent.
export function useDueRecurring(transactions: Transaction[]): DueRecurring[] {
  return useMemo(() => {
    const today = todayISO();
    const templateMap = new Map<string, Transaction>();

    for (const tx of transactions) {
      if (!tx.recurrence) continue;
      const key = `${tx.merchant}||${tx.category}||${tx.recurrence}`;
      const existing = templateMap.get(key);
      if (!existing || tx.date > existing.date) templateMap.set(key, tx);
    }

    const due: DueRecurring[] = [];
    for (const tx of templateMap.values()) {
      const due_date = nextDueDate(tx.date, tx.recurrence!);
      if (due_date <= today) {
        const overdueDays = Math.floor(
          (new Date(today).getTime() - new Date(due_date).getTime()) / 86400000
        );
        due.push({ template: tx, dueDate: due_date, overdueDays });
      }
    }

    return due.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [transactions]);
}

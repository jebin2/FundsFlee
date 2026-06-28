"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Transaction } from "@/types";
import { useOfflineFetch } from "@/hooks/useOfflineFetch";
import { saveLocalTransaction } from "@/lib/offline";
import { useTransactionsStore } from "@/store/transactionsStore";
import { TRANSACTIONS_URL } from "@/lib/api/transactions";

export function useCreateTransaction() {
  const router = useRouter();
  const { safeFetch } = useOfflineFetch();
  const addTransaction = useTransactionsStore((s) => s.addTransaction);
  const [saving, setSaving] = useState(false);

  async function createTransaction(tx: Transaction): Promise<string | null> {
    setSaving(true);
    try {
      const res = await safeFetch(TRANSACTIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: tx }),
        offlineBody: { transaction: tx },
      });
      const data = await res.json().catch(() => ({ offline: true })) as { transaction?: Transaction; error?: string; offline?: boolean };
      if (!res.ok && !data.offline) return data.error ?? "Save failed";
      const saved: Transaction = data.transaction ?? tx;
      await saveLocalTransaction(saved);
      addTransaction(saved);
      router.push("/dashboard");
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Failed to save. Try again.";
    } finally {
      setSaving(false);
    }
  }

  return { createTransaction, saving };
}

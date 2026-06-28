"use client";

import { useState, useCallback } from "react";
import type { PendingSuggestion, Transaction } from "@/types";
import { itemsApi } from "@/lib/api/items";

export function useTransactionSuggestions(loadData: () => Promise<Transaction[]>) {
  const [suggestions, setSuggestions] = useState<Record<string, PendingSuggestion[]>>({});
  const [activeSuggTxId, setActiveSuggTxId] = useState<string | null>(null);

  const loadSuggestions = useCallback(async (txList: Transaction[]) => {
    const [res] = await Promise.all([
      itemsApi.getSuggestions(),
      itemsApi.normalize().catch(() => {}),
    ]);
    if (!res.ok) return;
    const data = await res.json();
    const pending: PendingSuggestion[] = data.suggestions ?? [];

    const map: Record<string, PendingSuggestion[]> = {};
    for (const s of pending) {
      if (s.source === "normalize" && s.tx_ids) {
        for (const txId of s.tx_ids) {
          const tx = txList.find((t) => t.id === txId);
          if (tx && tx.item_name?.toLowerCase() === s.current_val.toLowerCase()) {
            (map[txId] ??= []).push(s);
          }
        }
      } else if (s.source === "notes") {
        const txId = s.key.replace(/^tx:/, "");
        (map[txId] ??= []).push(s);
      }
    }
    setSuggestions(map);
  }, []);

  async function handleSuggestion(s: PendingSuggestion, action: "accept" | "reject") {
    setSuggestions((prev) => {
      const next = { ...prev };
      for (const txId of Object.keys(next)) {
        next[txId] = next[txId].filter((x) => !(x.key === s.key && x.field === s.field));
        if (next[txId].length === 0) delete next[txId];
      }
      return next;
    });

    await itemsApi.resolveSuggestion(s, action);

    if (action === "accept") loadData();
  }

  return { suggestions, activeSuggTxId, setActiveSuggTxId, loadSuggestions, handleSuggestion };
}

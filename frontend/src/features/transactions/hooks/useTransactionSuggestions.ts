"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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

  // Editing notes retires whatever was suggested from the old ones, so the
  // badge has to go now — it describes text that no longer exists. The
  // replacement comes from a background AI call, so one follow-up pass picks
  // it up a moment later rather than polling for it.
  const followUp = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshAfterNotesEdit = useCallback(async () => {
    const txs = await loadData();
    await loadSuggestions(txs);
    if (followUp.current) clearTimeout(followUp.current);
    followUp.current = setTimeout(() => {
      loadData().then(loadSuggestions);
    }, 6000);
  }, [loadData, loadSuggestions]);

  useEffect(() => () => {
    if (followUp.current) clearTimeout(followUp.current);
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

  return { suggestions, activeSuggTxId, setActiveSuggTxId, loadSuggestions,
           refreshAfterNotesEdit, handleSuggestion };
}

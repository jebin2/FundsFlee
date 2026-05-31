"use client";

import { useMemo } from "react";
import type { Transaction } from "@/types";
import { formatINR } from "@/components/TransactionRow";
import { useTransactionsStore } from "@/store/transactionsStore";
import { getLocalTransactions, removeLocalTransaction } from "@/lib/offline";
import { useEffect, useState } from "react";
import { AddInfoSheet } from "./AddInfoSheet";
import { useTransactions } from "@/hooks/useTransactions";

export function ReceiptItemsPopup({ receiptId, source, onClose }: { receiptId: string; source?: string; onClose: () => void }) {
  // Try the already-loaded store first (covers all loaded pages, no network needed)
  const storeTransactions = useTransactionsStore((s) => s.transactions);
  const removeTransaction  = useTransactionsStore((s) => s.removeTransaction);
  const { refresh } = useTransactions();

  const storeItems = useMemo(
    () => storeTransactions
      .filter((t) => t.receipt_id === receiptId)
      .sort((a, b) => a.item_name?.localeCompare(b.item_name ?? "") ?? 0),
    [storeTransactions, receiptId]
  );

  // If the store has the items, use them directly — no loading state needed
  const [extraItems, setExtraItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(storeItems.length === 0);
  const [fromCache, setFromCache] = useState(false);
  const [showAddInfo, setShowAddInfo] = useState(false);

  useEffect(() => {
    // Only fetch from IndexedDB if the store has no matching items
    // (e.g., receipt created before the user loaded this session's pages)
    if (storeItems.length > 0) return;

    setLoading(true);
    (async () => {
      try {
        const cached = await getLocalTransactions();
        const found = cached
          .filter((t) => t.receipt_id === receiptId)
          .sort((a, b) => a.item_name?.localeCompare(b.item_name ?? "") ?? 0);
        setExtraItems(found);
        if (found.length > 0) setFromCache(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [receiptId, storeItems.length]);

  const items = storeItems.length > 0 ? storeItems : extraItems;
  const total = items.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
      onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-3xl overflow-hidden"
        style={{ background: "var(--color-surface)", maxHeight: "80vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <p style={{ fontSize: 17, fontWeight: 700, color: "var(--color-on-surface)" }}>
              {source === "receipt" ? "All items from this receipt" : "All items from this order"}
            </p>
            {!loading && (
              <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>
                {items.length} items · {formatINR(total)} total
                {fromCache && " · from cache"}
              </p>
            )}
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: "var(--color-surface-container)" }}>
            <span className="material-symbols-outlined" style={{ color: "var(--color-on-surface-variant)" }}>close</span>
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-8 flex flex-col gap-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
            </div>
          ) : items.map((item, i) => (
            <div key={item.id} className="flex items-center justify-between px-4 py-3 rounded-2xl"
              style={{ background: "var(--color-surface-container-lowest)", border: "1px solid var(--color-surface-variant)" }}>
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: 14, fontWeight: 500, color: "var(--color-on-surface)" }}>{item.item_name || `Item ${i + 1}`}</p>
                {item.notes && <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)" }}>{item.notes}</p>}
                <p style={{ fontSize: 12, color: "var(--color-outline)" }}>{item.category}</p>
              </div>
              <p style={{ fontSize: 15, fontWeight: 700, color: "var(--color-on-surface)", marginLeft: 12 }}>{formatINR(item.amount)}</p>
            </div>
          ))}
          {!loading && items.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 rounded-2xl mt-1" style={{ background: "var(--color-primary-fixed)" }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-primary)" }}>Total</p>
              <p style={{ fontSize: 16, fontWeight: 700, color: "var(--color-primary)" }}>{formatINR(total)}</p>
            </div>
          )}
          {!loading && (
            <button
              onClick={() => setShowAddInfo(true)}
              className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border w-full text-left mt-1"
              style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)", cursor: "pointer" }}
            >
              <span className="material-symbols-outlined" style={{ color: "var(--color-secondary)", fontSize: 20, fontVariationSettings: "'FILL' 1" }}>note_add</span>
              <p style={{ fontSize: 14, fontWeight: 500, color: "var(--color-secondary)" }}>Add more info</p>
              <span className="material-symbols-outlined ml-auto" style={{ color: "var(--color-outline)", fontSize: 18 }}>chevron_right</span>
            </button>
          )}
        </div>
      </div>
      {showAddInfo && items.length > 0 && (
        <AddInfoSheet
          tx={{
            id:             receiptId,
            merchant:       items[0].merchant,
            amount:         total,
            date:           items[0].date,
            time:           items[0].time,
            payment_method: items[0].payment_method,
            category:       items[0].category,
            source:         "receipt",
            created_at:     items[0].created_at,
            updated_at:     items[0].updated_at,
          } as Transaction}
          receiptId={receiptId}
          onClose={() => setShowAddInfo(false)}
          onSubmitted={() => {
            items.forEach((item) => {
              removeTransaction(item.id);
              removeLocalTransaction(item.id).catch(() => {});
            });
            onClose();
            refresh();
          }}
        />
      )}
    </div>
  );
}

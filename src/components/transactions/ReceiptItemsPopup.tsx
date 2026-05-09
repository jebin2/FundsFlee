"use client";

import { useEffect, useState } from "react";
import type { Transaction } from "@/types";
import { formatINR } from "@/components/TransactionRow";
import { getLocalTransactions } from "@/lib/offline";

export function ReceiptItemsPopup({ receiptId, onClose }: { receiptId: string; onClose: () => void }) {
  const [items, setItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/transactions");
        const d = await r.json();
        const all: Transaction[] = d.transactions ?? [];
        setItems(
          all
            .filter((t) => t.receipt_id === receiptId)
            .sort((a, b) => a.item_name?.localeCompare(b.item_name ?? "") ?? 0)
        );
      } catch {
        // Offline — read from local cache
        const cached = await getLocalTransactions();
        setItems(
          cached
            .filter((t) => t.receipt_id === receiptId)
            .sort((a, b) => a.item_name?.localeCompare(b.item_name ?? "") ?? 0)
        );
        setFromCache(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [receiptId]);

  const total = items.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
      onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-3xl overflow-hidden"
        style={{ background: "var(--color-surface)", maxHeight: "80vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <p style={{ fontSize: 17, fontWeight: 700, color: "var(--color-on-surface)" }}>All items from this receipt</p>
            {!loading && (
              <p style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>
                {items.length} items · {formatINR(total)} total
                {fromCache && " · cached"}
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
        </div>
      </div>
    </div>
  );
}

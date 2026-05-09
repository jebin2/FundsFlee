"use client";

import { useEffect, useState } from "react";
import type { ItemPriceComparison } from "@/app/api/compare/items/route";

function formatINR(n: number) {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export default function ComparePage() {
  const [comparisons, setComparisons] = useState<ItemPriceComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/compare/items")
      .then((r) => r.json())
      .then((d) => setComparisons(d.comparisons ?? []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = comparisons.filter(
    (c) => !search || c.canonical.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6 pb-8 flex flex-col gap-5">
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-on-background)" }}>Price Compare</h1>
        <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }} className="mt-1">
          Same item, different merchants — AI-matched across your receipts
        </p>
      </div>

      {!loading && comparisons.length > 0 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items…"
          className="px-4 py-3 rounded-2xl outline-none"
          style={{ background: "var(--color-surface-container)", color: "var(--color-on-surface)", fontSize: 14 }}
        />
      )}

      {loading ? (
        <div className="flex flex-col items-center py-12 gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
            style={{ borderColor: "var(--color-primary-fixed)", borderTopColor: "var(--color-primary)" }} />
          <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)" }}>
            AI is matching item names…
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-4 text-center">
          <div className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl"
            style={{ background: "var(--color-surface-container)" }}>🔍</div>
          <p style={{ fontSize: 18, fontWeight: 600, color: "var(--color-on-surface)" }}>
            {comparisons.length === 0 ? "No comparisons yet" : "No results"}
          </p>
          <p style={{ fontSize: 14, color: "var(--color-on-surface-variant)", maxWidth: 300 }}>
            {comparisons.length === 0
              ? "Scan receipts from different merchants. Once the same item (even with slight typos) appears from 2+ merchants, it shows here."
              : "Try a different search term."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((comp) => {
            const cheapest = comp.entries[0];
            const priciest = comp.entries[comp.entries.length - 1];
            const saving = priciest.avgPrice - cheapest.avgPrice;

            return (
              <div key={comp.canonical} className="rounded-3xl border overflow-hidden"
                style={{ borderColor: "var(--color-outline-variant)", background: "var(--color-surface-container-lowest)" }}>
                {/* Header */}
                <div className="px-4 pt-4 pb-3 flex justify-between items-start border-b"
                  style={{ borderColor: "var(--color-surface-variant)" }}>
                  <p style={{ fontSize: 16, fontWeight: 600, color: "var(--color-on-surface)", flex: 1, marginRight: 8 }}>
                    {comp.canonical}
                  </p>
                  {saving > 0 && (
                    <span className="flex-shrink-0 px-3 py-1 rounded-full text-sm font-semibold"
                      style={{ background: "var(--color-success-container)", color: "var(--color-success)" }}>
                      Save {formatINR(saving)}
                    </span>
                  )}
                </div>

                {/* Merchant rows */}
                {comp.entries.map((entry, i) => {
                  const isCheapest = i === 0;
                  const barRatio = entry.avgPrice / priciest.avgPrice;
                  const hasPriceRange = entry.minPrice !== entry.maxPrice;

                  return (
                    <div key={entry.merchant} className="px-4 py-3 border-b last:border-0"
                      style={{ borderColor: "var(--color-surface-variant)" }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <p className="truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-on-surface)" }}>
                            {entry.merchant}
                          </p>
                          {isCheapest && (
                            <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={{ background: "var(--color-success-container)", color: "var(--color-success)" }}>
                              Best price
                            </span>
                          )}
                        </div>
                        <div className="text-right ml-3 flex-shrink-0">
                          <p style={{ fontSize: 15, fontWeight: 700, color: isCheapest ? "var(--color-success)" : "var(--color-on-surface)" }}>
                            {formatINR(entry.avgPrice)}
                          </p>
                          <p style={{ fontSize: 11, color: "var(--color-outline)" }}>
                            {hasPriceRange
                              ? `${formatINR(entry.minPrice)}–${formatINR(entry.maxPrice)} · ${entry.count}×`
                              : `${entry.count}× purchased`}
                          </p>
                        </div>
                      </div>
                      {entry.notes && (
                        <p style={{ fontSize: 12, color: "var(--color-on-surface-variant)", marginBottom: 6 }}>
                          {entry.notes}
                        </p>
                      )}
                      <div className="h-1.5 rounded-full" style={{ background: "var(--color-surface-container)" }}>
                        <div className="h-1.5 rounded-full transition-all"
                          style={{
                            width: `${Math.round(barRatio * 100)}%`,
                            background: isCheapest ? "var(--color-success)" : "var(--color-primary)",
                          }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

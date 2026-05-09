import { offlineDb } from "./db";
import { pendingCount } from "./queue";
import type { Transaction } from "@/types";

// Read from IndexedDB — instant, works offline
export async function getLocalTransactions(): Promise<Transaction[]> {
  const txs = await offlineDb.transactions.orderBy("date").reverse().toArray();
  return txs;
}

// Fetch from API and persist to IndexedDB — call when online.
// Write-first strategy: bulkPut new data, then delete stale rows.
// This is atomic-safe — if the app crashes mid-write, old data is still readable.
export async function pullTransactions(): Promise<Transaction[]> {
  const res = await fetch("/api/transactions");
  if (res.status === 401) throw new Error("auth_expired");
  if (!res.ok) throw new Error("fetch_failed");
  const { transactions } = await res.json() as { transactions: Transaction[] };

  if (transactions.length > 0) {
    await offlineDb.transactions.bulkPut(transactions);
    // Remove rows that no longer exist on the server
    // Stringify both sides to prevent type coercion mismatches
    const serverIds = new Set(transactions.map((t) => String(t.id)));
    const rawLocalIds = await offlineDb.transactions.toCollection().primaryKeys();
    const localIds = (rawLocalIds as (string | number)[]).map(String);
    const staleIds = localIds.filter((id) => !serverIds.has(id));
    if (staleIds.length > 0) {
      await offlineDb.transactions.bulkDelete(staleIds);
    }
  } else {
    // Server returned 0 — safe to clear local only if no offline ops are pending.
    // If queue is non-empty, offline-created transactions haven't flushed yet.
    const queued = await pendingCount();
    if (queued === 0) {
      await offlineDb.transactions.clear();
    }
  }
  return transactions;
}

// Persist a single transaction locally (used after optimistic write)
export async function saveLocalTransaction(tx: Transaction): Promise<void> {
  await offlineDb.transactions.put(tx);
}

// Remove a transaction from local cache
export async function removeLocalTransaction(id: string): Promise<void> {
  await offlineDb.transactions.delete(id);
}

// Patch a transaction in local cache
export async function patchLocalTransaction(id: string, updates: Partial<Transaction>): Promise<void> {
  const existing = await offlineDb.transactions.get(id);
  if (existing) {
    await offlineDb.transactions.put({ ...existing, ...updates });
  }
}

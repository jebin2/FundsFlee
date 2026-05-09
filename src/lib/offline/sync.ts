import { offlineDb } from "./db";
import type { Transaction } from "@/types";

// Read from IndexedDB — instant, works offline
export async function getLocalTransactions(): Promise<Transaction[]> {
  const txs = await offlineDb.transactions.orderBy("date").reverse().toArray();
  return txs;
}

// Fetch from API and persist to IndexedDB — call when online
export async function pullTransactions(): Promise<Transaction[]> {
  const res = await fetch("/api/transactions");
  if (res.status === 401) throw new Error("auth_expired");
  if (!res.ok) throw new Error("fetch_failed");
  const { transactions } = await res.json() as { transactions: Transaction[] };

  // Replace local cache entirely
  await offlineDb.transactions.clear();
  if (transactions.length > 0) {
    await offlineDb.transactions.bulkPut(transactions);
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

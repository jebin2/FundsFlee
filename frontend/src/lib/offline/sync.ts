import { offlineDb } from "./db";
import { pendingCount } from "./queue";
import type { Transaction } from "@/types";

export interface SyncPage {
  transactions: Transaction[];
  total: number;
}

// Read from IndexedDB — instant, works offline
export async function getLocalTransactions(): Promise<Transaction[]> {
  return offlineDb.transactions.orderBy("date").reverse().toArray();
}

// Module-level controller — aborts the previous fetch when a new pull starts.
// Prevents stale responses from overwriting fresh data on rapid refresh.
let pullController: AbortController | null = null;

// Fetch the whole history from the API and persist to IndexedDB. The server
// reads it from its local database, so there is no paging.
// Uses bulkPut only (no delete) so unsynced optimistic creates survive.
// Soft-deleted transactions are filtered server-side so they won't re-appear.
export async function pullTransactions(): Promise<SyncPage> {
  pullController?.abort();
  pullController = new AbortController();

  let res: Response;
  try {
    res = await fetch("/api/transactions", { signal: pullController.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("aborted");
    }
    throw err;
  }
  if (res.status === 401) throw new Error("auth_expired");
  if (!res.ok) throw new Error("fetch_failed");

  const { transactions, total } = await res.json() as SyncPage;

  if (transactions.length > 0) {
    await offlineDb.transactions.bulkPut(transactions);
  } else {
    // Server has no transactions.
    // Only clear local if there are no pending offline ops (unsynced creates).
    const queued = await pendingCount();
    if (queued === 0) {
      await offlineDb.transactions.clear();
    }
  }

  return { transactions, total };
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

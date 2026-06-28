import { offlineDb } from "./db";
import { pendingCount } from "./queue";
import type { Transaction } from "@/types";

export interface SyncPage {
  transactions: Transaction[];
  total: number;
  hasMore: boolean;
}

// Read from IndexedDB — instant, works offline
export async function getLocalTransactions(): Promise<Transaction[]> {
  return offlineDb.transactions.orderBy("date").reverse().toArray();
}

// Module-level controller — aborts the previous fetch when a new pull starts.
// Prevents stale responses from overwriting fresh data on rapid refresh.
let pullController: AbortController | null = null;

// Fetch one page from the API and persist to IndexedDB.
// Uses bulkPut only (no delete) — pages accumulate across loads.
// Soft-deleted transactions are filtered server-side so they won't re-appear.
export async function pullTransactions(page = 1, pageSize?: number): Promise<SyncPage> {
  // Only cancel in-flight page-1 fetches (load-more pages are independent)
  if (page === 1) {
    pullController?.abort();
    pullController = new AbortController();
  }
  const signal = page === 1 ? pullController!.signal : undefined;

  const url = pageSize
    ? `/api/transactions?page=${page}&pageSize=${pageSize}`
    : `/api/transactions?page=${page}`;

  let res: Response;
  try {
    res = await fetch(url, signal ? { signal } : undefined);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("aborted");
    }
    throw err;
  }
  if (res.status === 401) throw new Error("auth_expired");
  if (!res.ok) throw new Error("fetch_failed");

  const { transactions, total, hasMore } = await res.json() as SyncPage;

  if (transactions.length > 0) {
    await offlineDb.transactions.bulkPut(transactions);
  } else if (page === 1) {
    // Page 1 returned empty — server has no transactions.
    // Only clear local if there are no pending offline ops (unsynced creates).
    const queued = await pendingCount();
    if (queued === 0) {
      await offlineDb.transactions.clear();
    }
  }

  return { transactions, total, hasMore };
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

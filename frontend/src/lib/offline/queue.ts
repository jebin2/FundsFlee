import { offlineDb } from "./db";

// Module-level guard — prevents concurrent flush calls (e.g. rapid online events)
let flushing = false;

export async function enqueueOp(method: string, url: string, body: unknown): Promise<void> {
  await offlineDb.queue.add({
    method,
    url,
    body: JSON.stringify(body ?? null),
    created_at: Date.now(),
  });

  // Register a Background Sync tag so the SW can flush the queue even if
  // the user closes the tab before connectivity returns.
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then((reg) => (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register("flush-queue"))
      .catch(() => {}); // Silently ignore — Background Sync is not universally supported
  }
}

// Replay queued ops in order.
// - 2xx: delete from queue (success)
// - 4xx client error: delete and skip (will never succeed, discard)
// - 401/403: auth expired — stop and signal caller
// - 5xx / network error: stop and retry next time
export async function flushQueue(): Promise<{ authExpired: boolean }> {
  if (flushing) return { authExpired: false };
  flushing = true;

  try {
    const ops = await offlineDb.queue.orderBy("created_at").toArray();

    for (const op of ops) {
      try {
        const res = await fetch(op.url, {
          method: op.method,
          headers: { "Content-Type": "application/json" },
          body: op.body === "null" ? undefined : op.body,
        });

        if (res.ok) {
          await offlineDb.queue.delete(op.id!);
          continue;
        }

        if (res.status === 401 || res.status === 403) {
          return { authExpired: true };
        }

        if (res.status >= 400 && res.status < 500) {
          // Client error — will never succeed; record for user visibility then discard
          await offlineDb.conflicts.add({
            method: op.method, url: op.url, body: op.body,
            statusCode: res.status, failed_at: Date.now(),
          });
          await offlineDb.queue.delete(op.id!);
          continue;
        }

        // 5xx — stop, retry on next flush
        break;
      } catch {
        // Network gone again — stop
        break;
      }
    }

    return { authExpired: false };
  } finally {
    flushing = false;
  }
}

export async function pendingCount(): Promise<number> {
  return offlineDb.queue.count();
}

// Exposed so safeFetch can queue mutations while flush is in progress,
// preventing PATCH/DELETE from racing a concurrent POST on the server.
export function isFlushing(): boolean {
  return flushing;
}

export async function conflictCount(): Promise<number> {
  return offlineDb.conflicts.count();
}

export async function clearConflicts(): Promise<void> {
  await offlineDb.conflicts.clear();
}

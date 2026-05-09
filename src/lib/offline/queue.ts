import { offlineDb } from "./db";

export async function enqueueOp(method: string, url: string, body: unknown): Promise<void> {
  await offlineDb.queue.add({
    method,
    url,
    body: JSON.stringify(body ?? null),
    created_at: Date.now(),
  });
}

// Replay queued ops in order.
// - 2xx: delete from queue (success)
// - 4xx client error: delete and skip (will never succeed, discard)
// - 401/403: auth expired — stop and signal caller
// - 5xx / network error: stop and retry next time
export async function flushQueue(): Promise<{ authExpired: boolean }> {
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
        // Client error — this op will never succeed, discard it
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
}

export async function pendingCount(): Promise<number> {
  return offlineDb.queue.count();
}

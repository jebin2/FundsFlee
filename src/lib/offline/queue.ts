import { offlineDb } from "./db";

export async function enqueueOp(method: string, url: string, body: unknown): Promise<void> {
  await offlineDb.queue.add({
    method,
    url,
    body: JSON.stringify(body ?? null),
    created_at: Date.now(),
  });
}

// Replay all queued ops in order. Stops on first network failure.
export async function flushQueue(): Promise<void> {
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
      }
      // Non-OK but received = skip (don't retry bad requests)
    } catch {
      break; // network gone again — stop and wait for next online event
    }
  }
}

export async function pendingCount(): Promise<number> {
  return offlineDb.queue.count();
}

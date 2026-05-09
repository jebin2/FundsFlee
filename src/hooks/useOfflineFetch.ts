"use client";

import { useAppStore } from "@/store";
import { enqueueOp, pendingCount } from "@/lib/offline";

export function useOfflineFetch() {
  const { isOnline, setPendingCount } = useAppStore();

  async function safeFetch(
    url: string,
    options: RequestInit & { offlineBody?: unknown } = {}
  ): Promise<Response> {
    if (isOnline) {
      return fetch(url, options);
    }

    // Offline — queue the mutation and return a fake success response
    const method = options.method ?? "GET";
    if (method !== "GET") {
      const body = options.offlineBody ?? (options.body ? JSON.parse(options.body as string) : null);
      await enqueueOp(method, url, body);
      const count = await pendingCount();
      setPendingCount(count);
    }

    // Return a fake 200 so callers don't need to handle offline specially
    return new Response(JSON.stringify({ ok: true, offline: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { safeFetch, isOnline };
}

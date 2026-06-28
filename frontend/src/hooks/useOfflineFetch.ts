"use client";

import { useNetworkStore } from "@/store/networkStore";
import { enqueueOp, pendingCount, isFlushing } from "@/lib/offline";

function parseBody(options: RequestInit & { offlineBody?: unknown }): unknown {
  if (options.offlineBody !== undefined) return options.offlineBody;
  if (!options.body) return null;
  try {
    return JSON.parse(options.body as string);
  } catch {
    return options.body;
  }
}

async function queueMutation(
  method: string,
  url: string,
  options: RequestInit & { offlineBody?: unknown },
  setPendingCount: (n: number) => void
): Promise<Response> {
  await enqueueOp(method, url, parseBody(options));
  const count = await pendingCount();
  setPendingCount(count);
  return new Response(JSON.stringify({ ok: true, offline: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function useOfflineFetch() {
  const isOnline = useNetworkStore((s) => s.isOnline);
  const setPendingCount = useNetworkStore((s) => s.setPendingCount);

  async function safeFetch(
    url: string,
    options: RequestInit & { offlineBody?: unknown } = {}
  ): Promise<Response> {
    const method = options.method ?? "GET";

    if (!isOnline) {
      if (method === "GET") throw new Error("Offline: cannot fetch");
      return queueMutation(method, url, options, setPendingCount);
    }

    if (method !== "GET" && isFlushing()) {
      return queueMutation(method, url, options, setPendingCount);
    }

    try {
      const res = await fetch(url, options);
      // Server-side failure (5xx) on a mutation — queue it so it survives
      // Sheets rate limits (429) and transient 500s are the common cases
      if (method !== "GET" && res.status >= 500) {
        return queueMutation(method, url, options, setPendingCount);
      }
      return res;
    } catch {
      if (method !== "GET") {
        return queueMutation(method, url, options, setPendingCount);
      }
      throw new Error("Network error");
    }
  }

  return { safeFetch, isOnline };
}

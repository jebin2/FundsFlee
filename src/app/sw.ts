import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, NetworkFirst, NetworkOnly, ExpirationPlugin, CacheableResponsePlugin } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// ── Background Sync — flush IndexedDB queue when connectivity returns ─────────

interface QueuedOpSW {
  id: number;
  method: string;
  url: string;
  body: string;
  created_at: number;
}

// IDB transactions auto-commit when there are no pending requests — never mix
// `await fetch()` with an open IDB transaction. Instead:
//   Step 1: read all ops in a readonly transaction (auto-commits cleanly)
//   Step 2: for each op, execute fetch, then open a NEW readwrite transaction
//           to delete the op or record a conflict

function openSwDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("FundsFleeOffline", 2);
    req.onerror = () => reject(req.error);
    // Create the conflicts store if upgrading from v1 or opening fresh at v2
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("conflicts")) {
        db.createObjectStore("conflicts", { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function idbGetAll(db: IDBDatabase, storeName: string): Promise<QueuedOpSW[]> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as QueuedOpSW[]);
    req.onerror   = () => reject(req.error);
  });
}

function idbDeleteOp(db: IDBDatabase, id: number): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction("queue", "readwrite");
    tx.objectStore("queue").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => resolve(); // best-effort
  });
}

function idbRecordConflict(db: IDBDatabase, op: QueuedOpSW, statusCode: number): Promise<void> {
  return new Promise((resolve) => {
    const stores = db.objectStoreNames.contains("conflicts") ? ["queue", "conflicts"] : ["queue"];
    const tx = db.transaction(stores, "readwrite");
    if (db.objectStoreNames.contains("conflicts")) {
      tx.objectStore("conflicts").add({ method: op.method, url: op.url, body: op.body, statusCode, failed_at: Date.now() });
    }
    tx.objectStore("queue").delete(op.id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => resolve();
  });
}

async function flushQueueFromSW(): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openSwDb();
  } catch {
    return; // DB unavailable — give up
  }

  let ops: QueuedOpSW[];
  try {
    ops = await idbGetAll(db, "queue");
  } catch {
    db.close();
    return;
  }

  ops.sort((a, b) => a.created_at - b.created_at);

  for (const op of ops) {
    try {
      const res = await fetch(op.url, {
        method:  op.method,
        headers: { "Content-Type": "application/json" },
        body:    op.body === "null" ? undefined : op.body,
      });

      if (res.ok) {
        await idbDeleteOp(db, op.id);
        continue;
      }
      if (res.status === 401 || res.status === 403) break; // auth expired
      if (res.status >= 400 && res.status < 500) {
        await idbRecordConflict(db, op, res.status);
        continue;
      }
      break; // 5xx — retry on next sync
    } catch {
      break; // network gone
    }
  }

  db.close();
}

// ── Push notifications ─────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  const data = (event as PushEvent).data?.json() as {
    title?: string; body?: string; tag?: string; url?: string;
  } ?? {};

  (event as ExtendableEvent).waitUntil(
    self.registration.showNotification(data.title ?? "FundsFlee", {
      body:  data.body ?? "",
      icon:  "/icon-192.png",
      badge: "/icon-192.png",
      tag:   data.tag ?? "fundsflee",
      data:  { url: data.url ?? "/transactions" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  (event as NotificationEvent).notification.close();
  const url = ((event as NotificationEvent).notification.data?.url as string | undefined) ?? "/transactions";
  (event as ExtendableEvent).waitUntil(self.clients.openWindow(url));
});

// ── Serwist setup ─────────────────────────────────────────────────────────────

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: [
    // Web Share Target Level 2 — Chrome requires the SW to respond to the POST
    // so the app appears in the OS share sheet for image/file sharing.
    {
      matcher: /^https?:\/\/[^/]+\/api\/share/,
      handler: new NetworkOnly(),
      method: "POST",
    },
    {
      matcher: /^https?:\/\/[^/]+\/api\/auth\/session/,
      handler: new NetworkFirst({
        cacheName: "auth-session",
        plugins: [
          new ExpirationPlugin({ maxEntries: 1, maxAgeSeconds: 604800 }),
          new CacheableResponsePlugin({ statuses: [200] }),
        ],
      }),
    },
    {
      matcher: /^https?:\/\/[^/]+\/api\//,
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ request }: { request: Request }) => request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "pages",
        plugins: [
          new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 86400 }),
          new CacheableResponsePlugin({ statuses: [200] }),
        ],
      }),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }: { request: Request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();

// Register Background Sync handler AFTER serwist so it runs alongside SW lifecycle
self.addEventListener("sync", (event) => {
  if ((event as SyncEvent).tag === "flush-queue") {
    (event as ExtendableEvent).waitUntil(flushQueueFromSW());
  }
});

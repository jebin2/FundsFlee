/// <reference lib="webworker" />
// Service worker — Workbox injectManifest port of the original Serwist src/app/sw.ts.
// The Dexie layer owns offline DATA; the SW owns the app shell + push + background sync.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute, setCatchHandler, NavigationRoute } from "workbox-routing";
import { NetworkOnly, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { clientsClaim } from "workbox-core";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>;
};

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// ── Background Sync — flush IndexedDB queue when connectivity returns ─────────
// IDB transactions auto-commit when there are no pending requests — never mix
// `await fetch()` with an open IDB transaction. So: read ops in a readonly tx,
// then per op fetch and open a NEW readwrite tx to delete or record a conflict.

interface QueuedOpSW {
  id: number;
  method: string;
  url: string;
  body: string;
  created_at: number;
}

function openSwDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("FundsFleeOffline", 2);
    req.onerror = () => reject(req.error);
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
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as QueuedOpSW[]);
    req.onerror = () => reject(req.error);
  });
}

function idbDeleteOp(db: IDBDatabase, id: number): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction("queue", "readwrite");
    tx.objectStore("queue").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
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
    tx.onerror = () => resolve();
  });
}

async function flushQueueFromSW(): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openSwDb();
  } catch {
    return;
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
        method: op.method,
        headers: { "Content-Type": "application/json" },
        body: op.body === "null" ? undefined : op.body,
      });

      if (res.ok) {
        await idbDeleteOp(db, op.id);
        continue;
      }
      if (res.status === 401 || res.status === 403) break;
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

// ── Push notifications ───────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  const data = (event.data?.json() as { title?: string; body?: string; tag?: string; url?: string } | undefined) ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "FundsFlee", {
      body: data.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag ?? "fundsflee",
      data: { url: data.url ?? "/transactions" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data?.url as string | undefined) ?? "/transactions";
  event.waitUntil(self.clients.openWindow(url));
});

// ── Runtime caching (order matters — first match wins) ───────────────────────
// 1. Web Share Target Level 2 — Chrome requires the SW to respond to the POST.
registerRoute(/^https?:\/\/[^/]+\/api\/share/, new NetworkOnly(), "POST");

// 2. Session — NetworkFirst so a brief offline still knows who you are.
registerRoute(
  /^https?:\/\/[^/]+\/api\/auth\/session/,
  new NetworkFirst({
    cacheName: "auth-session",
    plugins: [new ExpirationPlugin({ maxEntries: 1, maxAgeSeconds: 604800 }), new CacheableResponsePlugin({ statuses: [200] })],
  }),
);

// 3. Everything else under /api/* — NetworkOnly (Dexie owns offline data).
registerRoute(/^https?:\/\/[^/]+\/api\//, new NetworkOnly());

// 4. App-shell navigations → precached index.html (SPA model). /api + /auth bypass.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), {
  denylist: [/^\/api\//, /^\/auth\//],
}));

// Offline document fallback when the navigation handler can't resolve.
setCatchHandler(async ({ request }) => {
  if (request.destination === "document") {
    const cached = await caches.match("/index.html");
    if (cached) return cached;
  }
  return Response.error();
});

// Background Sync — flush the offline write queue when the tag fires.
self.addEventListener("sync", (event) => {
  if ((event as ExtendableEvent & { tag: string }).tag === "flush-queue") {
    event.waitUntil(flushQueueFromSW());
  }
});

// Cutover cleanup — on a same-origin upgrade from the old Serwist (Next.js) PWA,
// delete every cache this Workbox SW doesn't own so installed apps never serve
// the dead Next shell. (cleanupOutdatedCaches only prunes Workbox's own versions.)
const KEEP_CACHE_PREFIXES = ["workbox", "auth-session"];
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => !KEEP_CACHE_PREFIXES.some((p) => n.startsWith(p))).map((n) => caches.delete(n)),
      );
    })(),
  );
});

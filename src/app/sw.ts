import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, NetworkFirst, ExpirationPlugin, CacheableResponsePlugin } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: [
    // Session — NetworkFirst with no timeout so cold starts never cause
    // a stale-cache fallback. Falls back to cache only when truly offline.
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
    // HTML pages — defaultCache's "pages" matcher checks Content-Type on
    // the REQUEST which is always empty for navigations. Use mode:navigate
    // instead so HTML is actually cached when the user visits pages online.
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

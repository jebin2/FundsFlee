import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

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
  navigationPreload: true,
  runtimeCaching: [
    // Cache the session endpoint so useSession() works offline (7-day TTL)
    {
      matcher: /^https?:\/\/[^/]+\/api\/auth\/session/,
      handler: "NetworkFirst",
      options: {
        cacheName: "auth-session",
        networkTimeoutSeconds: 3,
        expiration: { maxEntries: 1, maxAgeSeconds: 604800 },
        cacheableResponse: { statuses: [200] },
      },
    },
    // Serwist's defaultCache handles Next.js pages, RSC payloads, static
    // assets, and images correctly — it keeps HTML and RSC in separate
    // cache buckets, fixing the content-type collision we had before.
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        // Serve /~offline for any document request that fails offline
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();

import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default withPWA({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  fallbacks: {
    // Serve the pre-cached app shell ("/" HTML) for any offline navigation
    // that isn't in the runtime cache. Next.js client router reads the real
    // URL and renders the correct page — same pattern as CRA's index.html shell.
    document: "/",
  },
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
    // Pre-cache "/" at SW install time so it is available immediately offline,
    // even on the very first cold open (before any runtime caching has run).
    additionalManifestEntries: [{ url: "/", revision: null }],
    runtimeCaching: [
      {
        // Cache all app page HTML with NetworkFirst so visited pages are
        // served from cache when offline. Excludes /_next/ and /api/.
        urlPattern: /^https?:\/\/[^/]+(?!\/_next)(?!\/api).*/,
        handler: "NetworkFirst",
        options: {
          cacheName: "app-pages",
          networkTimeoutSeconds: 3,
          expiration: { maxEntries: 128, maxAgeSeconds: 86400 },
          cacheableResponse: { statuses: [200] },
        },
      },
    ],
  },
})(nextConfig);

import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const nextConfig: NextConfig = {
  turbopack: {},
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
    document: "/offline",
  },
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
    navigateFallback: "/offline",
    navigateFallbackDenylist: [/^\/api\//],
    runtimeCaching: [
      {
        // Cache all app page HTML with NetworkFirst (3s timeout → cache)
        // Excludes: API routes, _next static files, icons, manifest
        urlPattern: /^https?:\/\/[^/]+(\/(?!api\/|_next\/|icon|manifest)[^?]*)?(\?.*)?$/,
        handler: "NetworkFirst",
        options: {
          cacheName: "app-pages",
          networkTimeoutSeconds: 3,
          expiration: { maxEntries: 64, maxAgeSeconds: 86400 },
          cacheableResponse: { statuses: [200] },
        },
      },
    ],
  },
})(nextConfig);

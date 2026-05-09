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
    // Standalone HTML — NOT a Next.js page, so the client-side router
    // never tries to re-navigate to the original URL after hydration.
    document: "/offline.html",
  },
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
    navigateFallback: "/offline.html",
    // Exclude API and internal Next.js paths from fallback
    navigateFallbackDenylist: [/^\/api\//, /^\/_next\//],
  },
})(nextConfig);

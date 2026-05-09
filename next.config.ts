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
    // Activate new SW immediately without waiting for tabs to close
    skipWaiting: true,
    clientsClaim: true,
    // Serve /offline for any navigation that fails (network + cache miss)
    navigateFallback: "/offline",
    // Don't apply fallback to API routes
    navigateFallbackDenylist: [/^\/api\//],
  },
})(nextConfig);

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Only bundle the parts of these libraries that are used (lucide-react and
    // recharts are already handled by Next.js).
    optimizePackageImports: ["radix-ui", "motion"],
  },
  images: {
    // Smaller logo/avatar images for browsers that support AVIF.
    formats: ["image/avif", "image/webp"],
  },
  // Every page depends on the signed-in user, so pages are rendered per
  // request (Cache Components / partial prefetching are left off on purpose).
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Camera: our own pages only (the packing and handover scanners). It is allowed
          // on every page because in-app links don't reload the page, so a page-specific
          // rule would leave the camera blocked without the browser ever asking.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
      {
        // The service worker must always be fresh so updates reach phones.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;

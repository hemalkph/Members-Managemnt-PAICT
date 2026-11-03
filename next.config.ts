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
  // Citypak is its own Admin module with sections (/admin/citypak/bulk-uploads/…).
  // Earlier links – under Tute dispatch, or batch pages and downloads without the
  // section – go to the new place, which checks the person's access itself.
  async redirects() {
    const batch = ":id([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
    return [
      { source: "/admin/dispatch/citypak", destination: "/admin/citypak/bulk-uploads", permanent: false },
      { source: `/admin/dispatch/citypak/${batch}/:rest*`, destination: "/admin/citypak/bulk-uploads/:id/:rest*", permanent: false },
      { source: `/admin/citypak/${batch}/:rest*`, destination: "/admin/citypak/bulk-uploads/:id/:rest*", permanent: false },
    ];
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

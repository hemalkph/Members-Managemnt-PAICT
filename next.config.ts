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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

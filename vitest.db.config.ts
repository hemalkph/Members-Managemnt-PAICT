import path from "node:path";
import { defineConfig } from "vitest/config";

// Database tests: run against a throwaway local PostgreSQL (see tests/db/global-setup.ts).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/db/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});

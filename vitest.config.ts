import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests: pure logic, no database, no network.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});

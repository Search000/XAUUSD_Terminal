import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    restoreMocks: true,
    hookTimeout: 10_000,
    testTimeout: 10_000,
  },
});

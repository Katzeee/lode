import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ["./tests/design-system/support/setup.mjs"],
    include: ["src/**/*.test.ts", "tests/**/*.test.mjs"],
    pool: "forks",
    testTimeout: 120_000,
  },
});

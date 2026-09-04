import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ["./tests/design-system/support/setup.mjs"],
    include: ["tests/design-system/design-system.acceptance.test.mjs"],
    pool: "forks",
    testTimeout: 120_000,
  },
});

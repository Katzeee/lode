import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "src/**/*.test.ts", // unit tests — co-located with source
      "tests/**/*.test.ts", // property / differential / integration tests
    ],
    pool: "forks",
    testTimeout: 15000,
  },
});

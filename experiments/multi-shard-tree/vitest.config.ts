import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "bench/**/*.test.ts"],
    // Deterministic enough for a prototype; properties bring their own seeded RNG.
    pool: "forks",
    singleFork: true,
    // Fuzz/differential tests do heavy per-iteration CRDT work in one test.
    testTimeout: 120_000,
  },
});

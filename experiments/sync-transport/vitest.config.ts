import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Give the WASM-backed loro-crdt a little breathing room on slow CI/sandboxes.
    testTimeout: 30_000,
  },
});

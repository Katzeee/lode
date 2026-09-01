import { defineConfig } from "vitest/config";

// A root-level Vitest run has no workspace-specific include filter. Excluding dist keeps compiled
// test twins and generated build artifacts outside the source test run; workspace configs already
// restrict their own runs to src and tests.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
  },
});

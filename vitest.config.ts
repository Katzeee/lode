import { defineConfig } from "vitest/config";

// Root-level safety net for `vitest` invoked from the repo root (no per-workspace config in scope).
// vitest v4's defaultExclude dropped `**/dist/**` (it is now only node_modules + .git), so without
// this a root-level run picks up compiled `.test.js` under dist/ — redundant twins of the src tests
// vitest already runs, PLUS stale orphans left by deleted source (e.g. Phase-3's ActorStore removal,
// the identity→utils/crypto move). Per-workspace configs already restrict `include` to src/ + tests/,
// so this only affects root-level invocations. Keep this even though workspaces run their own config.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
  },
});

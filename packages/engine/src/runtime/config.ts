import type { PersistenceOptions } from "./workspace/registry.js";
import type { RoundSummary } from "./sync/driver.js";

/** Product policy injected once at the app composition root. This is the single config type — the host
 *  passes it to `createEngineRuntime`; the module graph reads it as `config`. `onRound` is the host's
 *  per-content-round summary hook (default: a rate-limited logger); omit `sync` for an in-memory/test
 *  runtime that never syncs. */
export type RuntimeConfig = {
  readonly persistence?: PersistenceOptions;
  readonly sync?: {
    readonly onRound?: (workspaceId: string, summary: RoundSummary) => void;
    readonly roundIntervalMs?: number;
  };
};

import type { PersistenceOptions } from "./workspace/registry.js";
import type { RoundSummary } from "./sync/driver.js";
import type { VaultTtl } from "./identity/vault-file.js";

/** Product policy injected once at the app composition root. This is the single config type — the host
 *  passes it to `createEngineRuntime`; the module graph reads it as `config`. `onRound` is the host's
 *  per-content-round summary hook (default: a rate-limited logger); omit `sync` for an in-memory/test
 *  runtime that never syncs. `vault.path` opts into the daemon-side identity vault (socket deployment);
 *  omit it for an in-process/test runtime that authenticates via `sessionHello` instead. `vault.ttl` is
 *  the unlock-lease policy (read by the host from config.json). */
export type RuntimeConfig = {
  readonly persistence?: PersistenceOptions;
  readonly sync?: {
    readonly onRound?: (workspaceId: string, summary: RoundSummary) => void;
    readonly roundIntervalMs?: number;
  };
  readonly vault?: {
    readonly path?: string;
    readonly ttl?: VaultTtl;
  };
};

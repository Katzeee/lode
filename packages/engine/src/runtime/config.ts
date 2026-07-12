import type { SyncDeps } from "./sync/deps.js";
import type { PersistenceOptions } from "./workspace/registry.js";

/** Product policy injected once at the app composition root. */
export type RuntimeConfig = {
  readonly persistence?: PersistenceOptions;
  readonly sync?: { readonly deps?: SyncDeps; readonly roundIntervalMs?: number };
};

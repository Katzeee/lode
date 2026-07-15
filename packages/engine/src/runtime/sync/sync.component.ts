import type { ComponentDefinition } from "../kernel/component.js";
import type { RuntimeConfig } from "../config.js";
import type { EngineServices } from "../services.js";
import type { VaultRuntime } from "../identity/vault.js";
import { createBrokerSyncTransport } from "./adapters/broker-sync-transport.js";
import { SyncService } from "./sync-service.js";

export const syncComponent: ComponentDefinition<
  EngineServices,
  "sync",
  "workspaces" | "vault",
  RuntimeConfig
> = {
  name: "sync",
  requires: ["workspaces", "vault"],
  create: ({ deps, config, instance }) => {
    const vault: VaultRuntime = deps.vault;
    const sync = new SyncService({
      workspaces: deps.workspaces,
      transportFactory: createBrokerSyncTransport,
      ...(config.sync?.onRound === undefined ? {} : { onRound: config.sync.onRound }),
      ...(config.sync?.roundIntervalMs === undefined
        ? {}
        : { roundIntervalMs: config.sync.roundIntervalMs }),
    });
    // Late-bind the vault's "is sync registered?" detector so lease expiry picks GRACE (keep keys for
    // background rounds) over LOCKED. sync knows vault; vault only holds the anonymous predicate.
    vault.setActiveSyncsDetector(() => sync.hasActiveSyncs());
    instance.own(sync);
    return sync;
  },
};

import type { ComponentDefinition } from "../kernel/component.js";
import type { RuntimeConfig } from "../config.js";
import type { EngineServices } from "../services.js";
import { createBrokerSyncTransport } from "./adapters/broker-sync-transport.js";
import { SyncService } from "./sync-service.js";

export const syncComponent: ComponentDefinition<
  EngineServices,
  "sync",
  "workspaces",
  RuntimeConfig
> = {
  name: "sync",
  requires: ["workspaces"],
  create: ({ deps, config, instance }) => {
    const sync = new SyncService({
      workspaces: deps.workspaces,
      transportFactory: createBrokerSyncTransport,
      ...(config.sync?.onRound === undefined ? {} : { onRound: config.sync.onRound }),
      ...(config.sync?.roundIntervalMs === undefined
        ? {}
        : { roundIntervalMs: config.sync.roundIntervalMs }),
    });
    instance.own(sync);
    return sync;
  },
};

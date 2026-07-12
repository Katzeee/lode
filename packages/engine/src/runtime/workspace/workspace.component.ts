import type { ComponentDefinition } from "../kernel/component.js";
import type { RuntimeConfig } from "../config.js";
import type { EngineServices } from "../services.js";
import { WorkspaceRegistry } from "./registry.js";

export const workspaceComponent: ComponentDefinition<
  EngineServices,
  "workspaces",
  never,
  RuntimeConfig
> = {
  name: "workspaces",
  create: ({ config, instance }) =>
    config.persistence
      ? WorkspaceRegistry.persistent(config.persistence, instance)
      : WorkspaceRegistry.inMemory(instance),
};

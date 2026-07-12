import type { ComponentDefinition } from "../kernel/component.js";
import type { RuntimeConfig } from "../config.js";
import type { EngineServices } from "../services.js";
import { ClientSessionManager } from "./client-session-manager.js";

export const sessionComponent: ComponentDefinition<
  EngineServices,
  "sessions",
  "workspaces",
  RuntimeConfig
> = {
  name: "sessions",
  requires: ["workspaces"],
  create: ({ deps, instance }) => {
    const sessions = new ClientSessionManager(instance, deps.workspaces.originLabel());
    instance.own(sessions);
    return sessions;
  },
};

import type { ComponentDefinition } from "../kernel/component.js";
import type { RuntimeConfig } from "../config.js";
import type { EngineServices } from "../services.js";
import { ClientSessionManager } from "./client-session-manager.js";

export const sessionComponent: ComponentDefinition<
  EngineServices,
  "sessions",
  "workspaces" | "vault",
  RuntimeConfig
> = {
  name: "sessions",
  requires: ["workspaces", "vault"],
  create: ({ deps, instance }) => {
    const sessions = new ClientSessionManager(instance, deps.workspaces.originLabel(), deps.vault);
    instance.own(sessions);
    return sessions;
  },
};

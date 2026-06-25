import { randomUUID } from "node:crypto";
import { AppWorkspaceRuntime, type PersistenceOptions } from "./persistence/runtime.js";
import { createLodeCommands, type AppContext } from "./services/index.js";
import { SessionManager } from "./services/session-manager.js";

export type { PersistenceOptions } from "./persistence/runtime.js";
export type { AppContext } from "./services/index.js";
export type { EngineOrigin } from "./services/session-manager.js";
export { SessionRequiredError, DocNotFoundError } from "./services/errors.js";
export { DomainInvalidInputError } from "./domain/errors.js";

export type LodeCommands = ReturnType<typeof createLodeCommands>;

export type AppRuntimeOptions = {
  nodeId?: string;
  persistence?: PersistenceOptions;
};

export type AppRuntime = {
  readonly nodeId: string;
  readonly workspaces: AppWorkspaceRuntime;
  // The LodeCommands service implementation (typed handlers keyed by RPC name). The daemon
  // binds this to a Connect server; in-process callers invoke handlers directly.
  readonly commands: LodeCommands;
  removeConnection(connectionId: string): void;
  close(): Promise<void>;
};

// Builds the in-process engine core: workspace runtime + the LodeCommands handler set +
// session/subscription/notification-stream bookkeeping. Transport-free — the host (daemon
// or mobile) drives connection lifecycle. Mirrors anytype-heart's core.New().
export async function createAppRuntime(options: AppRuntimeOptions = {}): Promise<AppRuntime> {
  const workspaces = options.persistence
    ? await AppWorkspaceRuntime.persistent(options.persistence)
    : await AppWorkspaceRuntime.inMemory();
  const nodeId = options.nodeId ?? randomUUID();
  const sessions = new SessionManager(nodeId);
  const ctx: AppContext = { workspaces, sessions };
  const commands = createLodeCommands(ctx);

  return {
    nodeId,
    workspaces,
    commands,
    removeConnection: (connectionId) => sessions.removeConnection(connectionId),
    close: async () => {
      await workspaces.close();
    },
  };
}

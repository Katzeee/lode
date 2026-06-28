import { randomUUID } from "node:crypto";
import { App, type Component } from "./app.js";
import { AppWorkspaceRuntime, type PersistenceOptions } from "./workspace-registry.js";
import { SessionManager } from "../session/session-manager.js";
import { createLodeCommands, type AppContext } from "../services/index.js";

export type AppRuntimeOptions = {
  nodeId?: string;
  persistence?: PersistenceOptions;
};

export type LodeCommands = ReturnType<typeof createLodeCommands>;

export type AppRuntime = {
  readonly nodeId: string;
  readonly workspaces: AppWorkspaceRuntime;
  // The LodeCommands service implementation (typed handlers keyed by RPC name). The daemon
  // binds this to a Connect server; in-process callers invoke handlers directly.
  readonly commands: LodeCommands;
  removeConnection(connectionId: string): void;
  close(): Promise<void>;
};

// Adapts the workspace registry to the Component lifecycle: stop tears down every loaded
// workspace sub-runtime (each a ChildApp) and the registry store. Registered so the
// daemon-global App owns the teardown ordering; future subsystems (sync, indexer) register
// alongside it.
class WorkspaceRegistryComponent implements Component {
  readonly name = "workspace-registry";
  constructor(readonly runtime: AppWorkspaceRuntime) {}
  async stop(): Promise<void> {
    await this.runtime.close();
  }
}

// Builds the in-process engine core as a component graph: a top-level App registers the
// daemon-global subsystems and drives their lifecycle. Each loaded workspace is a ChildApp
// of this App (see workspace-registry.ts). Transport-free — the host (daemon or mobile)
// drives connection lifecycle. Mirrors anytype-heart's app.App bootstrap.
export async function createAppRuntime(options: AppRuntimeOptions = {}): Promise<AppRuntime> {
  const app = new App();
  const workspaces = options.persistence
    ? await AppWorkspaceRuntime.persistent(options.persistence, () => app.child())
    : await AppWorkspaceRuntime.inMemory(() => app.child());
  // Persistent mode: the session/notification nodeId is the stable per-dataRoot peerId, so a
  // restart keeps the same device identity (the session origin label matches the Loro site id).
  // In-memory mode: a fresh randomUUID (Loro auto-assigns peer ids; tests don't need stability).
  const nodeId =
    options.nodeId ?? (workspaces.peerId !== undefined ? String(workspaces.peerId) : randomUUID());
  const sessions = new SessionManager(nodeId);
  const ctx: AppContext = { workspaces, sessions };
  const commands = createLodeCommands(ctx);

  app.register(new WorkspaceRegistryComponent(workspaces));
  await app.start();

  return {
    nodeId,
    workspaces,
    commands,
    removeConnection: (connectionId) => sessions.removeConnection(connectionId),
    close: () => app.stop(),
  };
}

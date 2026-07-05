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
  /** The session manager — exposed so daemon-side handlers (sync governance/share/join) can gate on
   *  `requireOrigin`, the same gate the engine's own write handlers use. */
  readonly sessions: SessionManager;
  // The LodeCommands service implementation (typed handlers keyed by RPC name). The daemon
  // binds this to a Connect server; in-process callers invoke handlers directly.
  readonly commands: LodeCommands;
  /** The composition root. The engine registers its subsystems here but does NOT start them — the
   *  host (daemon/mobile) registers its own components (sync, relay, http) and drives lifecycle via
   *  `app.start()` (registration order) / `app.stop()` (reverse). Anytype-ideal: assemble-then-start. */
  readonly app: App;
  removeConnection(connectionId: string): void;
};

// Adapts the workspace registry to the Component lifecycle: stop tears down every loaded
// workspace sub-runtime (each a ChildApp) and the registry store. Registered first so it stops LAST
// (workspaces outlive everything that uses them).
class WorkspaceRegistryComponent implements Component {
  readonly name = "workspace-registry";
  constructor(readonly runtime: AppWorkspaceRuntime) {}
  async stop(): Promise<void> {
    await this.runtime.close();
  }
}

// Builds the in-process engine core: constructs the subsystems, registers the workspace registry on a
// fresh App, and returns — WITHOUT starting. The host is the composition root: it registers its own
// components on `runtime.app` and calls `app.start()`. Each loaded workspace is a ChildApp of this App
// (see workspace-registry.ts). Transport-free — the host drives connection lifecycle. Mirrors
// anytype-heart's app.App bootstrap.
export async function createAppRuntime(options: AppRuntimeOptions = {}): Promise<AppRuntime> {
  const app = new App();
  const workspaces = options.persistence
    ? await AppWorkspaceRuntime.persistent(options.persistence, () => app.child())
    : await AppWorkspaceRuntime.inMemory(() => app.child());
  // Persistent mode: the session/notification nodeId is the stable per-dataRoot peerId, so a
  // restart keeps the same peer identity (the session origin label matches the Loro site id).
  // In-memory mode: a fresh randomUUID (Loro auto-assigns peer ids; tests don't need stability).
  const nodeId =
    options.nodeId ?? (workspaces.peerId !== undefined ? String(workspaces.peerId) : randomUUID());
  const sessions = new SessionManager(nodeId);
  const ctx: AppContext = { workspaces, sessions };
  const commands = createLodeCommands(ctx);

  app.register(new WorkspaceRegistryComponent(workspaces));

  return {
    nodeId,
    workspaces,
    sessions,
    commands,
    app,
    removeConnection: (connectionId) => sessions.removeConnection(connectionId),
  };
}

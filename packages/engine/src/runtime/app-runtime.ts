import { App, type Component } from "./app.js";
import { AppWorkspaceRuntime, type PersistenceOptions } from "./workspace/registry.js";
import { SessionManager } from "../session/session-manager.js";
import { createLodeCommands, type AppContext } from "../services/index.js";
import { SyncRegistry } from "./sync/registry.js";
import type { SyncDeps } from "./sync/deps.js";

export type AppRuntimeOptions = {
  persistence?: PersistenceOptions;
  /** Secured-sync configuration: host policy hooks + the round interval. Omit for an in-memory/test
   *  runtime that never syncs. */
  sync?: {
    deps?: SyncDeps;
    roundIntervalMs?: number;
  };
};

export type LodeCommands = ReturnType<typeof createLodeCommands>;

// The HOST surface. Hosts (daemon, mobile, embedded) reach the engine ONLY through these four:
// every client operation goes AppServerClient → `commands` (the single client route, over a
// pluggable transport); host-only relay-lifecycle handlers (share/join/register/syncNow) go through
// `sync`; gating goes through `sessions`; lifecycle goes through `app`. The internal subsystems
// (the workspace registry, the peer/node id) are NOT here — there is no second route around the
// guarded primitives in `commands`.
export type AppRuntime = {
  /** The session manager — exposed so daemon-side handlers (sync governance/share/join) can gate on
   *  `requireOrigin`, the same gate the engine's own write handlers use. */
  readonly sessions: SessionManager;
  // The LodeCommands service implementation (typed handlers keyed by RPC name). The daemon
  // binds this to a Connect server; an in-process host binds a direct transport. Either way every
  // client operation lands here — never bypassing it to the workspace registry or membership log.
  readonly commands: LodeCommands;
  /** The sync coordinator — per-workspace sync sub-graphs over a relay. Exposed so the host
   *  (daemon/mobile) can drive register/share/join/syncNow through it without importing engine sync
   *  internals. In-process hosts get the same surface. */
  readonly sync: SyncRegistry;
  /** The composition root. The engine registers its subsystems here but does NOT start them — the
   *  host (daemon/mobile) registers its own components (sync, relay, http) and drives lifecycle via
   *  `app.start()` (registration order) / `app.stop()` (reverse). Anytype-ideal: assemble-then-start. */
  readonly app: App;
};

// Adapts the workspace registry to the Component lifecycle: stop tears down every loaded
// workspace sub-runtime (each a ChildApp) and the registry store. The workspaces are the
// notification broadcasters (engine write handlers call sessions.broadcastNodeUpdated), so they
// must stop BEFORE the session manager — the registry is registered after it.
class WorkspaceRegistryComponent implements Component {
  readonly name = "workspace-registry";
  constructor(readonly runtime: AppWorkspaceRuntime) {}
  start(): void {
    // Fail-loud if createAppRuntime skipped attachWorkspaceStateHolders — a workspace's death would
    // otherwise silently leak sync + session state.
    this.runtime.assertStateHoldersAttached();
  }
  async stop(): Promise<void> {
    await this.runtime.close();
  }
}

// Adapts the SessionManager to the Component lifecycle: stop completes every open notification
// stream and clears the session/subscriber maps. session/ sits below runtime/ in the DAG, so the
// Component adapter lives here, not on SessionManager itself. Registered FIRST so it stops LAST —
// after the workspace broadcasters and the host's connect/relay components — so `app.stop()` closes
// the streams only once no component can still broadcast.
class SessionManagerComponent implements Component {
  readonly name = "session-manager";
  constructor(readonly sessions: SessionManager) {}
  stop(): void {
    this.sessions.close();
  }
}

// Builds the in-process engine core: constructs the subsystems, registers the workspace registry on a
// fresh App, and returns — WITHOUT starting. The host is the composition root: it registers its own
// components on `runtime.app` and calls `app.start()`. Each loaded workspace is a ChildApp of this App
// (see workspace/registry.ts). Transport-free — the host drives connection lifecycle. Mirrors
// anytype-heart's app.App bootstrap.
export async function createAppRuntime(options: AppRuntimeOptions = {}): Promise<AppRuntime> {
  const app = new App();
  const workspaces = options.persistence
    ? await AppWorkspaceRuntime.persistent(options.persistence, () => app.child())
    : await AppWorkspaceRuntime.inMemory(() => app.child());
  // The session origin label comes from the peer identity (the stable per-dataRoot peerId, so a
  // restart keeps the same origin) — the peerId→string policy lives in PeerIdentity, not copied here.
  const sessions = new SessionManager(workspaces.originLabel());
  const ctx: AppContext = { workspaces, sessions };
  const commands = createLodeCommands(ctx);
  const sync = new SyncRegistry({
    workspaces,
    ...(options.sync?.deps === undefined ? {} : { deps: options.sync.deps }),
    ...(options.sync?.roundIntervalMs === undefined
      ? {}
      : { roundIntervalMs: options.sync.roundIntervalMs }),
  });
  // Wire the cross-component per-workspace state holders so a workspace's death purges them too.
  workspaces.attachWorkspaceStateHolders(sync, sessions);

  app.register(new SessionManagerComponent(sessions));
  app.register(new WorkspaceRegistryComponent(workspaces));
  app.register(sync);

  return {
    sessions,
    commands,
    sync,
    app,
  };
}

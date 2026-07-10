import { App, type Component } from "./app.js";
import { AppWorkspaceRuntime, type PersistenceOptions } from "./workspace/registry.js";
import { SessionIdentity } from "./identity/session-identity.js";
import { NotificationManager } from "./notification/notification-manager.js";
import { createSessionRpcs } from "./commands/session-rpcs.js";
import { createLodeCommands, type AppContext } from "../services/index.js";
import { wrapCommands, type WrappedCommands } from "./commands/wrap-commands.js";
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
/** The session/notification/identity RPCs (runtime/session-rpcs) — merged with the domain commands
 *  before auth-wrapping. */
type SessionRpcs = ReturnType<typeof createSessionRpcs>;
/** The command bag transports invoke: each `(req, connectionId) => result`, with the caller resolved
 *  at this seam (auth chokepoint — see wrapCommands). Covers the domain commands + the session RPCs. */
export type RuntimeCommands = WrappedCommands<LodeCommands & SessionRpcs>;

// The HOST surface. Hosts (daemon, mobile, embedded) reach the engine ONLY through these: every
// client operation goes AppServerClient → `commands` (the single client route, over a pluggable
// transport); host-only relay-lifecycle handlers (share/join/register/syncNow) go through `sync`;
// the identity + notification halves are exposed for the host's own connection lifecycle (resolve a
// caller, tear down a connection); lifecycle goes through `app`. The internal subsystems (workspace
// registry, peer/node id) are NOT here — there is no second route around the guarded `commands`.
export type AppRuntime = {
  /** The auth/identity half — session store + the caller resolver the command wrapper gates on. Host
   *  handlers (daemon sync: share/join/register) use it to resolve the actor. */
  readonly identity: SessionIdentity;
  /** The notification pub/sub half — per-connection streams + per-workspace subscribers. The host
   *  tears a connection down via removeConnection on both halves. */
  readonly notify: NotificationManager;
  // The LodeCommands service, auth-wrapped at this seam. The daemon binds it to a Connect server;
  // an in-process host binds a direct transport. Either way every client operation lands here,
  // authenticated at the boundary — never bypassing it to the workspace registry or membership log.
  readonly commands: RuntimeCommands;
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
// notification broadcasters (engine write handlers broadcast via the notify port), so they must
// stop BEFORE the notification half — the registry is registered after it.
class WorkspaceRegistryComponent implements Component {
  readonly name = "workspace-registry";
  constructor(readonly runtime: AppWorkspaceRuntime) {}
  start(): void {
    // Fail-loud if createAppRuntime skipped attachWorkspaceStateHolders — a workspace's death would
    // otherwise silently leak sync + notification state.
    this.runtime.assertStateHoldersAttached();
  }
  async stop(): Promise<void> {
    await this.runtime.close();
  }
}

// Adapts the session-state halves to the Component lifecycle: stop closes every open notification
// stream (notify) then clears the session bookkeeping (identity). Registered FIRST so it stops LAST
// — after the workspace broadcasters and the host's connect/relay components — so `app.stop()`
// closes the streams only once no component can still broadcast.
class SessionStateComponent implements Component {
  readonly name = "session-state";
  constructor(
    readonly identity: SessionIdentity,
    readonly notify: NotificationManager,
  ) {}
  stop(): void {
    this.notify.close();
    this.identity.close();
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
  const identity = new SessionIdentity(workspaces.originLabel());
  const notify = new NotificationManager();
  const ctx: AppContext = { workspaces, notify };
  // The domain commands (services) + the session/notification/identity RPCs (runtime) merged, then
  // auth-wrapped at this seam: transports invoke `(req, connectionId)` and the wrapper resolves the
  // caller here — the single auth chokepoint, reached identically by the daemon socket transport and
  // the engine-free in-process transport.
  const commands = wrapCommands(
    { ...createLodeCommands(ctx), ...createSessionRpcs(identity, notify, workspaces) },
    identity,
  );
  const sync = new SyncRegistry({
    workspaces,
    ...(options.sync?.deps === undefined ? {} : { deps: options.sync.deps }),
    ...(options.sync?.roundIntervalMs === undefined
      ? {}
      : { roundIntervalMs: options.sync.roundIntervalMs }),
  });
  // Wire the cross-component per-workspace state holders so a workspace's death purges them too.
  workspaces.attachWorkspaceStateHolders(sync, notify);

  app.register(new SessionStateComponent(identity, notify));
  app.register(new WorkspaceRegistryComponent(workspaces));
  app.register(sync);

  return {
    identity,
    notify,
    commands,
    sync,
    app,
  };
}

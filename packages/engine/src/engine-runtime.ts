import { Lifecycle } from "./runtime/lifecycle.js";
import { WorkspaceRegistry, type PersistenceOptions } from "./runtime/workspace/registry.js";
import { SessionIdentity } from "./runtime/identity/session-identity.js";
import { NotificationManager } from "./runtime/notification/notification-manager.js";
import { createSessionRpcs } from "./commands/session-rpcs.js";
import { createCommands, type CommandDeps, type Commands } from "./commands/index.js";
import { wrapCommands } from "./commands/wrap-commands.js";
import { SyncRegistry } from "./runtime/sync/registry.js";
import type { SyncDeps } from "./runtime/sync/deps.js";

export type EngineRuntimeOptions = {
  persistence?: PersistenceOptions;
  /** Secured-sync configuration: host policy hooks + the round interval. Omit for an in-memory/test
   *  runtime that never syncs. */
  sync?: {
    deps?: SyncDeps;
    roundIntervalMs?: number;
  };
};

// The HOST surface — intentionally narrow. A host (daemon, mobile, embedded) reaches the engine ONLY
// through `commands` (every client RPC, auth-wrapped at this seam) + `app` (lifecycle: the host
// registers its own components + drives start/stop) + `onConnectionClosed` (the single
// connection-teardown hook). The internal subsystems (identity, notification, sync, the workspace
// registry) are NOT exposed: there is no second route around the guarded `commands`, and a host
// never resolves a caller or tears down a connection by reaching into a subsystem directly.
export type EngineRuntime = {
  // The LodeCommands service, auth-wrapped at this seam. The daemon binds it to a Connect server;
  // an in-process host binds a direct transport. Either way every client operation lands here,
  // authenticated at the boundary — never bypassing it to the workspace registry or membership log.
  readonly commands: Commands;
  /** The composition root. The engine registers its subsystems here but does NOT start them — the
   *  host (daemon/mobile) registers its own components (connect server, relay) and drives lifecycle
   *  via `lifecycle.start()` (registration order) / `lifecycle.stop()` (reverse). Anytype-ideal: assemble-then-start. */
  readonly lifecycle: Lifecycle;
  /** Connection-lifecycle hook: a transport (the daemon's HTTP/2 socket, an in-process host) calls
   *  this when a connection drops so the engine purges that connection's session record + notification
   *  stream + subscriber entries. The single teardown seam — identity + notify are internal. */
  onConnectionClosed(connectionId: string): void;
};

// Builds the in-process engine core: constructs the subsystems, registers them on a fresh Lifecycle, and
// returns — WITHOUT starting. The host is the composition root: it registers its own components on
// `runtime.lifecycle` and calls `lifecycle.start()`. Each loaded workspace is a ChildApp of this Lifecycle (see
// workspace/registry.ts). Transport-free — the host drives connection lifecycle. Mirrors
// anytype-heart's app.App bootstrap.
export async function createEngineRuntime(
  options: EngineRuntimeOptions = {},
): Promise<EngineRuntime> {
  const app = new Lifecycle();
  const workspaces = options.persistence
    ? await WorkspaceRegistry.persistent(options.persistence, () => app.child())
    : await WorkspaceRegistry.inMemory(() => app.child());
  // The session origin label comes from the peer identity (the stable per-dataRoot peerId, so a
  // restart keeps the same origin) — the peerId→string policy lives in PeerIdentity, not copied here.
  const identity = new SessionIdentity(workspaces.originLabel());
  const notify = new NotificationManager();
  const sync = new SyncRegistry({
    workspaces,
    ...(options.sync?.deps === undefined ? {} : { deps: options.sync.deps }),
    ...(options.sync?.roundIntervalMs === undefined
      ? {}
      : { roundIntervalMs: options.sync.roundIntervalMs }),
  });
  const ctx: CommandDeps = { workspaces, notify, sync };
  // The full handler set — domain commands + session/notification/identity RPCs — merged, then
  // auth-wrapped at this seam: transports invoke `(req, connectionId)` and the wrapper resolves the
  // caller here (the single auth chokepoint). share/join/register/syncNow are `authed` handlers in
  // the bag now (ctx.sync), so every LodeCommands RPC routes through this one funnel — reached
  // identically by the daemon socket transport and the engine-free in-process transport.
  const commands = wrapCommands(
    { ...createCommands(ctx), ...createSessionRpcs(identity, notify, workspaces) },
    identity,
  );
  // Wire the cross-component per-workspace state holders so a workspace's death purges them too.
  workspaces.attachWorkspaceStateHolders(sync, notify);

  // Registration order = start order; stop runs in reverse. identity + notify register FIRST so they
  // stop LAST — after the workspace broadcasters and the host's connect/relay components — so
  // lifecycle.stop() closes notification streams only once no component can still broadcast. Each subsystem
  // carries its own Component lifecycle (no adapter classes): SessionIdentity / NotificationManager /
  // WorkspaceRegistry / SyncRegistry all implement Component directly.
  app.register(identity);
  app.register(notify);
  app.register(workspaces);
  app.register(sync);

  return {
    commands,
    lifecycle: app,
    // Converge the identity + notification connection teardown into one host-facing hook. identity
    // and notify stay internal — no host resolves a caller or touches a stream directly.
    onConnectionClosed: (connectionId: string) => {
      identity.removeConnection(connectionId);
      notify.removeConnection(connectionId);
    },
  };
}

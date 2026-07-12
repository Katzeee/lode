import { AppRuntime } from "./runtime/kernel/app-runtime.js";
import { installComponents } from "./runtime/kernel/component.js";
import type { RuntimeConfig } from "./runtime/config.js";
import type { EngineServices } from "./runtime/services.js";
import { workspaceComponent } from "./runtime/workspace/workspace.component.js";
import { sessionComponent } from "./runtime/session/session.component.js";
import { syncComponent } from "./runtime/sync/sync.component.js";
import { createSessionRpcs } from "./commands/session-rpcs.js";
import { createCommands, type CommandDeps, type Commands } from "./commands/index.js";
import { wrapCommands } from "./commands/wrap-commands.js";
import type { PersistenceOptions } from "./runtime/workspace/registry.js";
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
// through `commands` (every client RPC, auth-wrapped at this seam) + `app` (the ownership root:
// the host registers its own resources and drives start/shutdown) + `onConnectionClosed` (the single
// connection-teardown hook). The internal subsystems (the module graph: identity, sync, the workspace
// registry) are NOT exposed: there is no second route around the guarded `commands`.
export type EngineRuntime = {
  readonly commands: Commands;
  /** The composition root. The host adds transport resources before starting the complete app. */
  readonly app: AppRuntime;
  /** Connection-lifecycle hook: a transport calls this when a connection drops so the engine purges
   *  that connection's session record + notification stream + subscriber entries. */
  onConnectionClosed(connectionId: string): Promise<void>;
};

// The composition root is now a manifest: declare which modules make the runtime + inject config, and
// the module registry resolves the dependency graph (topo-started, cycle-checked) into services. The
// modules carry their own `requires` + construction recipes; this function no longer constructs or
// orders anything by hand. It then composes the one host surface (the auth-wrapped command funnel)
// from the resolved services.
export async function createEngineRuntime(
  options: EngineRuntimeOptions = {},
): Promise<EngineRuntime> {
  const app = new AppRuntime("engine");
  const config: RuntimeConfig = {
    ...(options.persistence === undefined ? {} : { persistence: options.persistence }),
    ...(options.sync === undefined
      ? {}
      : {
          sync: {
            ...(options.sync.deps === undefined ? {} : { deps: options.sync.deps }),
            ...(options.sync.roundIntervalMs === undefined
              ? {}
              : { roundIntervalMs: options.sync.roundIntervalMs }),
          },
        }),
  };
  const services: EngineServices = await installComponents<EngineServices, RuntimeConfig>(
    app,
    [workspaceComponent, sessionComponent, syncComponent],
    config,
  );

  const ctx: CommandDeps = { workspaces: services.workspaces, sync: services.sync };
  const commands = wrapCommands(
    { ...createCommands(ctx), ...createSessionRpcs(services.sessions, services.workspaces) },
    services.sessions,
  );

  return {
    commands,
    app,
    onConnectionClosed: (connectionId: string) => {
      return services.sessions.removeConnection(connectionId);
    },
  };
}

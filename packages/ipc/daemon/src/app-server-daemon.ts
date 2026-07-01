import {
  createAppRuntime,
  deriveActorKeypairFromMnemonic,
  type AppRuntime,
  type PersistenceOptions,
} from "@lode/engine";
import { parseListenUrl } from "./listen-url.js";
import { BrokerServerComponent } from "./broker-server-component.js";
import { ConnectServerComponent } from "./connect-server-component.js";
import { DaemonSyncRunner } from "./sync-runner.js";
import { createSyncHandlers } from "./sync-handlers.js";

export type AppServerDaemonOptions = {
  listen: string;
  dataRoot?: string;
  persistence?: PersistenceOptions;
  /** Host the workspace-routing broker (relay) in-process (opt-in `--relay`, design §3). */
  relay?: { port?: number; host?: string };
  /** Sync configuration. `actorMnemonic` is always required (sync is secured: transit-key AEAD + the
   *  membership log). Owner: `url` + `workspaceIds` pre-configured (it bootstraps the membership root);
   *  members are added via the `AddMember` RPC. Member: just the mnemonic — it `JoinWorkspace`es at
   *  runtime with a coordinate from the owner. */
  sync?: {
    actorMnemonic: string;
    url?: string;
    workspaceIds?: string[];
    intervalMs?: number;
  };
};

export type AppServerDaemon = {
  address: string;
  /** The in-process relay's WebSocket URL, when `--relay` is set (for other devices to dial). */
  relayUrl?: string;
  stop(): Promise<void>;
};

// Hosts the engine as a local gRPC (HTTP/2, h2c) daemon. The daemon IS the composition root: it
// builds the runtime, registers the connect server (+ optional relay + sync runner) on the runtime's
// App, then starts them in registration order. `stop()` is the App's reverse-order teardown — no
// hand-ordered closure. Mirrors anytype-heart's cmd/grpcserver bootstrap shape.
export async function startAppServerDaemon(
  options: AppServerDaemonOptions,
): Promise<AppServerDaemon> {
  const { host, port } = parseListenUrl(options.listen);
  const persistence =
    options.persistence ?? (options.dataRoot ? { dataRoot: options.dataRoot } : undefined);
  const runtime: AppRuntime = await createAppRuntime(persistence ? { persistence } : {});

  // Build the sync runner + its RPC handlers before registration so the Connect server can merge
  // them with the engine's LodeCommands. An owner pre-configures `url` + `workspaceIds` (it
  // bootstraps the membership root); a member starts with just a mnemonic and JoinWorkspaces at
  // runtime. No `--bootstrap-member`: members arrive via the AddMember RPC.
  const syncRunner =
    options.sync !== undefined
      ? new DaemonSyncRunner({
          workspaces: runtime.workspaces,
          ...(options.sync.url === undefined ? {} : { url: options.sync.url }),
          workspaceIds: options.sync.workspaceIds ?? [],
          intervalMs: options.sync.intervalMs,
          actorKeypair: deriveActorKeypairFromMnemonic(options.sync.actorMnemonic),
        })
      : undefined;
  const syncHandlers = createSyncHandlers(syncRunner, runtime.sessions);

  // Register in start-order; the App stops them in reverse. createAppRuntime already registered the
  // workspace registry FIRST → it stops LAST (workspaces outlive everything that uses them).
  const connect = runtime.app.register(
    new ConnectServerComponent(runtime, host, port, syncHandlers),
  );
  const relay =
    options.relay !== undefined
      ? runtime.app.register(
          new BrokerServerComponent({ port: options.relay.port, host: options.relay.host }),
        )
      : undefined;
  // The sync runner stops FIRST (closes outbound transports before the relay/workspaces go).
  if (syncRunner !== undefined) {
    runtime.app.register(syncRunner);
  }

  await runtime.app.start();

  return {
    address: connect.address,
    ...(relay === undefined ? {} : { relayUrl: relay.url }),
    stop: () => runtime.app.stop(),
  };
}

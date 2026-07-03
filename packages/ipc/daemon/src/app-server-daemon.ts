import { createAppRuntime, type AppRuntime, type PersistenceOptions } from "@lode/engine";
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
  /** Sync round interval (default 20000ms); exposed for tests. The daemon has no sync identity —
   *  workspaces are registered at runtime by sessions (RegisterSync / JoinWorkspace). */
  syncIntervalMs?: number;
};

/** Relay-only mode options (no engine, no gRPC — just the broker). */
export type RelayDaemonOptions = {
  relay?: { port?: number; host?: string };
};

export type AppServerDaemon = {
  address: string;
  /** The in-process relay's WebSocket URL, when `--relay` is set (for other devices to dial). */
  relayUrl?: string;
  stop(): Promise<void>;
};

export type RelayDaemon = {
  relayUrl: string;
  stop(): Promise<void>;
};

/** Parsed CLI args — a discriminated union of engine mode (`--listen` present) and relay-only. The
 *  bin switches on `mode` and feeds the matching starter; the discriminant makes the narrowing exact
 *  (no whole-object narrowing workaround). */
export type EngineParsedArgs = AppServerDaemonOptions & { mode: "engine" };
export type RelayParsedArgs = RelayDaemonOptions & { mode: "relay" };
export type ParsedAppServerArgs = EngineParsedArgs | RelayParsedArgs;

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

  // The sync runner has no identity of its own — every syncing workspace is registered by a session
  // (RegisterSync / JoinWorkspace), which captures that session's actor keypair. Built unconditionally:
  // any daemon can sync once a client registers.
  const syncRunner = new DaemonSyncRunner({
    workspaces: runtime.workspaces,
    ...(options.syncIntervalMs === undefined ? {} : { intervalMs: options.syncIntervalMs }),
  });
  const syncHandlers = createSyncHandlers(syncRunner, runtime.workspaces, runtime.sessions);

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
  runtime.app.register(syncRunner);

  await runtime.app.start();

  return {
    address: connect.address,
    ...(relay === undefined ? {} : { relayUrl: relay.url }),
    stop: () => runtime.app.stop(),
  };
}

/** Relay-only mode: host just the workspace-routing broker — no engine, no gRPC, no identity. One
 *  binary, three modes (design sync-design.md §5); the bin picks this entry when `--listen` is
 *  absent. Uses `BrokerServerComponent` directly (single-component lifecycle needs no App wrapper). */
export async function startRelayDaemon(options: RelayDaemonOptions = {}): Promise<RelayDaemon> {
  const component = new BrokerServerComponent({
    port: options.relay?.port,
    host: options.relay?.host,
  });
  await component.start();
  return { relayUrl: component.url, stop: () => component.stop() };
}

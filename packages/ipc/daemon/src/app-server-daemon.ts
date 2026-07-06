import { readFileSync } from "node:fs";
import { createAppRuntime, type AppRuntime, type PersistenceOptions } from "@lode/engine";
import { parseListenUrl } from "./listen-url.js";
import { BrokerServerComponent } from "./broker-server-component.js";
import { ConnectServerComponent } from "./connect-server-component.js";
import { createSyncHandlers } from "./sync-handlers.js";

/** Read the relay's TLS cert/key PEM files (from `--tls-cert`/`--tls-key` paths) for
 *  `BrokerServerComponent`. Empty when TLS isn't configured (h2c plaintext — the default). */
function readRelayTls(relay: { tlsCertPath?: string; tlsKeyPath?: string } | undefined): {
  tlsCert?: string;
  tlsKey?: string;
} {
  if (relay?.tlsCertPath === undefined || relay.tlsKeyPath === undefined) {
    return {};
  }
  return {
    tlsCert: readFileSync(relay.tlsCertPath, "utf8"),
    tlsKey: readFileSync(relay.tlsKeyPath, "utf8"),
  };
}

export type AppServerDaemonOptions = {
  listen: string;
  dataRoot?: string;
  persistence?: PersistenceOptions;
  /** Host the workspace-routing broker (relay) in-process (opt-in `--relay`, design §3). */
  relay?: { port?: number; host?: string; tlsCertPath?: string; tlsKeyPath?: string };
  /** Sync round interval (default 20000ms); exposed for tests. The daemon has no sync identity —
   *  workspaces are registered at runtime by sessions (RegisterSync / JoinWorkspace). */
  syncIntervalMs?: number;
};

/** Relay-only mode options (no engine, no gRPC — just the broker). */
export type RelayDaemonOptions = {
  relay?: { port?: number; host?: string; tlsCertPath?: string; tlsKeyPath?: string };
};

export type AppServerDaemon = {
  address: string;
  /** The in-process relay's URL (HTTP/2, `http://` plaintext or `https://` with TLS), when `--relay`
   *  is set (for other peers to dial). */
  relayUrl?: string;
  stop(): Promise<void>;
};

export type RelayDaemon = {
  relayUrl: string;
  stop(): Promise<void>;
};

/** Parsed CLI args — a discriminated union of engine mode (`--listen` present) and relay-only. The
 *  bin switches on `mode` and feeds the matching starter; the discriminant makes the narrowing exact
 *  (no whole-object narrowing workaround). `logFile` is a bin-level concern (the bin calls
 *  `configureLogger` before starting) — not passed to the starters. */
export type EngineParsedArgs = AppServerDaemonOptions & { mode: "engine"; logFile?: string };
export type RelayParsedArgs = RelayDaemonOptions & { mode: "relay"; logFile?: string };
export type ParsedAppServerArgs = EngineParsedArgs | RelayParsedArgs;

// Hosts the engine as a local gRPC (HTTP/2, h2c) daemon. The daemon IS the composition root: it
// builds the runtime (which registers the workspace registry + the engine-owned SyncRegistry
// on the App), then registers the connect server (+ optional relay) and starts everything in
// registration order. `stop()` is the App's reverse-order teardown. Mirrors anytype-heart's
// cmd/grpcserver bootstrap shape.
export async function startAppServerDaemon(
  options: AppServerDaemonOptions,
): Promise<AppServerDaemon> {
  const { host, port } = parseListenUrl(options.listen);
  const persistence =
    options.persistence ?? (options.dataRoot ? { dataRoot: options.dataRoot } : undefined);
  const runtime: AppRuntime = await createAppRuntime({
    ...(persistence ? { persistence } : {}),
    // The registry has no identity of its own — every syncing workspace is registered by a session
    // (RegisterSync / JoinWorkspace), which captures that session's actor keypair.
    ...(options.syncIntervalMs === undefined
      ? {}
      : { sync: { roundIntervalMs: options.syncIntervalMs } }),
  });
  const syncHandlers = createSyncHandlers(runtime.sync, runtime.sessions);

  // Register in start-order; the App stops them in reverse. createAppRuntime already registered the
  // workspace registry + the SyncRegistry → they stop LAST (sync + workspaces outlive the
  // connect/relay components that sit on top of them).
  const connect = runtime.app.register(
    new ConnectServerComponent(runtime, host, port, syncHandlers),
  );
  const relay =
    options.relay !== undefined
      ? runtime.app.register(
          new BrokerServerComponent({
            port: options.relay.port,
            host: options.relay.host,
            ...readRelayTls(options.relay),
          }),
        )
      : undefined;

  await runtime.app.start();

  return {
    address: connect.address,
    ...(relay === undefined ? {} : { relayUrl: relay.url }),
    stop: () => runtime.app.stop(),
  };
}

/** Relay-only mode: host just the workspace-routing broker (BrokerService over h2) — no engine, no
 *  LodeCommands client→core gRPC, no identity. One binary, three modes (design sync-design.md §5);
 *  the bin picks this entry when `--listen` is absent. Uses `BrokerServerComponent` directly
 *  (single-component lifecycle needs no App wrapper). */
export async function startRelayDaemon(options: RelayDaemonOptions = {}): Promise<RelayDaemon> {
  const component = new BrokerServerComponent({
    port: options.relay?.port,
    host: options.relay?.host,
    ...readRelayTls(options.relay),
  });
  await component.start();
  return { relayUrl: component.url, stop: () => component.stop() };
}

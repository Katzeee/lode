import { readFileSync } from "node:fs";
import {
  AppRuntime,
  createEngineRuntime,
  type EngineRuntime,
  type PersistenceOptions,
  type StopReport,
} from "@lode/engine";
import { parseListenUrl } from "./listen-url.js";
import { BrokerServerResource } from "./resources/broker-server-resource.js";
import { ConnectServerResource } from "./resources/connect-server-resource.js";

/** Read the relay's TLS cert/key PEM files (from `--tls-cert`/`--tls-key` paths) for
 *  `BrokerServerResource`. Empty when TLS isn't configured (h2c plaintext — the default). */
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
  stop(): Promise<StopReport>;
};

export type RelayDaemon = {
  relayUrl: string;
  stop(): Promise<StopReport>;
};

/** Parsed CLI args — a discriminated union of engine mode (`--listen` present) and relay-only. The
 *  bin switches on `mode` and feeds the matching starter; the discriminant makes the narrowing exact
 *  (no whole-object narrowing workaround). `logFile` is a bin-level concern (the bin calls
 *  `configureLogger` before starting) — not passed to the starters. */
type EngineParsedArgs = AppServerDaemonOptions & { mode: "engine"; logFile?: string };
type RelayParsedArgs = RelayDaemonOptions & { mode: "relay"; logFile?: string };
export type ParsedAppServerArgs = EngineParsedArgs | RelayParsedArgs;

// Hosts the engine as a local gRPC (HTTP/2, h2c) daemon. The daemon is the composition root: it
// builds the engine app, adds transport resources, then starts the complete ownership tree.
export async function startAppServerDaemon(
  options: AppServerDaemonOptions,
): Promise<AppServerDaemon> {
  const { host, port } = parseListenUrl(options.listen);
  const persistence =
    options.persistence ?? (options.dataRoot ? { dataRoot: options.dataRoot } : undefined);
  const runtime: EngineRuntime = await createEngineRuntime({
    ...(persistence ? { persistence } : {}),
    // The service has no identity of its own — every syncing workspace is registered by a session
    // (RegisterSync / JoinWorkspace), which captures that session's actor keypair.
    ...(options.syncIntervalMs === undefined
      ? {}
      : { sync: { roundIntervalMs: options.syncIntervalMs } }),
  });
  const connect = runtime.app.root.own(new ConnectServerResource(runtime, host, port));
  const relay =
    options.relay !== undefined
      ? runtime.app.root.own(
          new BrokerServerResource({
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
 *  the bin picks this entry when `--listen` is absent. The relay runs in its own app and therefore
 *  shares the same deterministic shutdown protocol as engine mode. */
export async function startRelayDaemon(options: RelayDaemonOptions = {}): Promise<RelayDaemon> {
  const app = new AppRuntime("relay-daemon");
  const relay = app.root.own(
    new BrokerServerResource({
      port: options.relay?.port,
      host: options.relay?.host,
      ...readRelayTls(options.relay),
    }),
  );
  await app.start();
  return { relayUrl: relay.url, stop: () => app.stop() };
}

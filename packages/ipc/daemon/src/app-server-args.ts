import type { ParsedAppServerArgs } from "./app-server-daemon.js";

// CLI parsing for the AppServer daemon. `--listen`/`--data-root` are the local-service surface;
// `--relay` hosts the workspace-routing broker in-process (design sync-design.md §3; the relay is a
// user-deployed, stateless coordinate). The daemon carries no sync identity — workspaces are
// registered at runtime by sessions (RegisterSync / JoinWorkspace), so there are no sync flags here.
// Kept explicit (no flag lib) to match the daemon's minimal argv style.

const USAGE = `Usage: app-server [--listen <url>] [--data-root <path>] [--relay [<port>]] [--tls-cert <path> --tls-key <path>] [--log-file <path>]
    --listen:    engine daemon (the gRPC service clients talk to)
    --relay:     host the workspace-routing broker (omit --listen for a relay-only process)
    --tls-cert:  PEM cert for the relay over h2+TLS (requires --relay + --tls-key; default h2c plaintext)
    --tls-key:   PEM key paired with --tls-cert
    --data-root: where the engine persists data (default: in-memory)
    --log-file:  append structured logs (JSON) to a size-rotated file, ALONGSIDE stderr
                 (default: stderr only). Rotation: 50 MB × 5 backups.
  At least one of --listen / --relay is required.`;

/** Read the value immediately following `flag`, or undefined if absent / if the next token is another flag. */
function valueAfter(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) {
    return undefined;
  }
  const next = argv[i + 1];
  if (next === undefined || next.startsWith("--")) {
    return undefined;
  }
  return next;
}

export function parseAppServerArgs(argv: string[]): ParsedAppServerArgs {
  const listen = valueAfter(argv, "--listen");
  const dataRoot = valueAfter(argv, "--data-root");
  const logFile = valueAfter(argv, "--log-file");
  const tlsCertPath = valueAfter(argv, "--tls-cert");
  const tlsKeyPath = valueAfter(argv, "--tls-key");
  const hasRelay = argv.includes("--relay");

  // At least one of --listen / --relay. --listen absent + --relay present = relay-only (no engine).
  if (!listen && !hasRelay) {
    throw new Error(USAGE);
  }
  // TLS terminates at the relay. Detect bare-flag presence (argv.includes) — `valueAfter` returns
  // undefined when the next token is another flag, so checking only the parsed values would let
  // `--tls-cert --tls-key --relay` (both values missing) silently no-op into plaintext h2c.
  const hasTlsCert = argv.includes("--tls-cert");
  const hasTlsKey = argv.includes("--tls-key");
  if (hasTlsCert || hasTlsKey) {
    if (!hasTlsCert || !hasTlsKey) {
      throw new Error("--tls-cert and --tls-key must be provided together");
    }
    if (tlsCertPath === undefined || tlsKeyPath === undefined) {
      throw new Error("--tls-cert/--tls-key require a value (a PEM file path)");
    }
    if (!hasRelay) {
      throw new Error("--tls-cert/--tls-key require --relay (TLS terminates at the relay)");
    }
  }

  // `--relay` alone = ephemeral port; `--relay 4193` = fixed port; absent = undefined.
  let relay:
    { port?: number; host?: string; tlsCertPath?: string; tlsKeyPath?: string } | undefined;
  if (hasRelay) {
    const portToken = valueAfter(argv, "--relay");
    const port = portToken === undefined ? undefined : Number.parseInt(portToken, 10);
    relay = {
      ...(port !== undefined && !Number.isNaN(port) ? { port } : {}),
      ...(tlsCertPath !== undefined ? { tlsCertPath } : {}),
      ...(tlsKeyPath !== undefined ? { tlsKeyPath } : {}),
    };
  }

  // Relay-only: --relay without --listen (no engine, no dataRoot).
  if (listen === undefined) {
    return {
      mode: "relay",
      ...(relay === undefined ? {} : { relay }),
      ...(logFile === undefined ? {} : { logFile }),
    };
  }
  // Engine mode.
  return {
    mode: "engine",
    listen,
    ...(dataRoot === undefined ? {} : { dataRoot }),
    ...(relay === undefined ? {} : { relay }),
    ...(logFile === undefined ? {} : { logFile }),
  };
}

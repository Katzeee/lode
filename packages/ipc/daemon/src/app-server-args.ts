import type { ParsedAppServerArgs } from "./app-server-daemon.js";

// CLI parsing for the AppServer daemon. `--listen`/`--data-root` are the local-service surface;
// `--relay` hosts the workspace-routing broker in-process (design sync-design.md §3; the relay is a
// user-deployed, stateless coordinate). The daemon carries no sync identity — workspaces are
// registered at runtime by sessions (RegisterSync / JoinWorkspace), so there are no sync flags here.
// Kept explicit (no flag lib) to match the daemon's minimal argv style.

const USAGE = `Usage: app-server [--listen <url>] [--data-root <path>] [--relay [<port>]] [--log-file <path>]
    --listen:    engine daemon (the gRPC service clients talk to)
    --relay:     host the workspace-routing broker (omit --listen for a relay-only process)
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
  const hasRelay = argv.includes("--relay");

  // At least one of --listen / --relay. --listen absent + --relay present = relay-only (no engine).
  if (!listen && !hasRelay) {
    throw new Error(USAGE);
  }

  // `--relay` alone = ephemeral port; `--relay 4193` = fixed port; absent = undefined.
  let relay: { port?: number; host?: string } | undefined;
  if (hasRelay) {
    const portToken = valueAfter(argv, "--relay");
    if (portToken === undefined) {
      relay = {};
    } else {
      const port = Number.parseInt(portToken, 10);
      relay = Number.isNaN(port) ? {} : { port };
    }
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

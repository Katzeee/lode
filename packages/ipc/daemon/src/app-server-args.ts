import type { AppServerDaemonOptions } from "./app-server-daemon.js";

// CLI parsing for the AppServer daemon. `--listen`/`--data-root` are the local-service surface;
// `--relay` hosts the workspace-routing broker in-process (design sync-design.md §3; the relay is a
// user-deployed, stateless coordinate); `--sync-url` + `--sync-workspace` dial a relay and drive CRDT
// sync rounds for the named workspaces. `--actor-mnemonic` switches sync to the secured path:
// transit-key AEAD + actor signing, with the membership log converging over a plaintext envelope.
// Kept explicit (no flag lib) to match the daemon's minimal argv style.

const USAGE = `Usage: app-server --listen <url> [--data-root <path>] [--relay [<port>]] [--sync-url <url> --sync-workspace <id>... [--actor-mnemonic <12 words>] [--bootstrap-member <hex-sign-pub>...]]`;

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

/** Read every value following each occurrence of `flag` (repeatable), skipping flag-like tokens. */
function valuesAfter(argv: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const value = argv[i + 1];
    if (token === flag && value !== undefined && !value.startsWith("--")) {
      out.push(value);
    }
  }
  return out;
}

/** Read a multi-word value (a BIP-39 mnemonic is 12 space-separated words): consume every token after
 *  `flag` until the next `--flag` or end of argv. */
function mnemonicAfter(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) {
    return undefined;
  }
  const words: string[] = [];
  for (let j = i + 1; j < argv.length; j++) {
    const tok = argv[j];
    if (tok === undefined || tok.startsWith("--")) {
      break;
    }
    words.push(tok);
  }
  return words.length === 0 ? undefined : words.join(" ");
}

export function parseAppServerArgs(argv: string[]): AppServerDaemonOptions {
  const listen = valueAfter(argv, "--listen");
  if (!listen) {
    throw new Error(USAGE);
  }
  const dataRoot = valueAfter(argv, "--data-root");
  const syncUrl = valueAfter(argv, "--sync-url");
  const syncWorkspaces = valuesAfter(argv, "--sync-workspace");
  const actorMnemonic = mnemonicAfter(argv, "--actor-mnemonic");
  const bootstrapMembersHex = valuesAfter(argv, "--bootstrap-member");

  const options: AppServerDaemonOptions = { listen };
  if (dataRoot) {
    options.dataRoot = dataRoot;
  }
  if (argv.includes("--relay")) {
    // `--relay` alone = ephemeral port; `--relay 4193` binds a fixed port.
    const portToken = valueAfter(argv, "--relay");
    if (portToken === undefined) {
      options.relay = {};
    } else {
      const port = Number.parseInt(portToken, 10);
      options.relay = Number.isNaN(port) ? {} : { port };
    }
  }
  if (syncUrl) {
    if (syncWorkspaces.length === 0) {
      throw new Error("--sync-url requires at least one --sync-workspace <id>");
    }
    if (!actorMnemonic) {
      throw new Error("--sync-url requires --actor-mnemonic <12 words> (sync is always secured)");
    }
    options.sync = { url: syncUrl, workspaceIds: syncWorkspaces, actorMnemonic };
    if (bootstrapMembersHex.length > 0) {
      options.sync.bootstrapMembers = bootstrapMembersHex.map((hex) => Buffer.from(hex, "hex"));
    }
  }
  return options;
}

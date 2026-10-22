import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Code, ConnectError } from "@connectrpc/connect";
import { createDesktopClient, type DaemonStatusView, type DesktopClient } from "./desktop-client.js";
import type { HomeRegistryFile } from "./home-registry.js";

export type HomeSelection = Readonly<{ name: string; path: string }>;

/** A home that cannot be selected or connected with the current configuration —
 * the CLI surfaces these as `configuration-missing`. */
export class HomeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HomeConfigurationError";
  }
}

/** Spawns the daemon for a Home. Provided by the composition root — the
 * desktop-client never depends on a daemon implementation. Resolves once the
 * process is started; readiness is observed through Status polling. */
type DaemonLauncher = (selection: HomeSelection) => void | Promise<void>;

export type DaemonReadinessOptions = Readonly<{
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}>;

type HomeConnectionFiles = Readonly<{ endpoint: string; token: string }>;

function homeConnectionFiles(homePath: string): HomeConnectionFiles {
  return { endpoint: join(homePath, "endpoint"), token: join(homePath, "token") };
}

/** `--home` > `LODE_HOME` > lode.toml `default_home` > `main`; the resolved
 * name must be registered — nothing is ever implicitly created. */
export function selectHome(
  registry: HomeRegistryFile,
  flagName: string | undefined,
  envName: string | undefined,
): HomeSelection {
  const name = flagName ?? envName ?? registry.defaultHome ?? "main";
  const entry = registry.homes[name];
  if (!entry) {
    const registered = Object.keys(registry.homes);
    const known =
      registered.length === 0 ? " No homes are registered yet." : ` Registered homes: ${registered.join(", ")}.`;
    throw new HomeConfigurationError(
      `Home "${name}" is not registered.${known} Register one with \`lode home add <name> <path>\`.`,
    );
  }
  return { name, path: entry.path };
}

async function readTextOrNone(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw new HomeConfigurationError(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readHomeToken(files: HomeConnectionFiles): Promise<string> {
  const token = await readTextOrNone(files.token);
  if (!token) {
    throw new HomeConfigurationError(
      `Home has no access token at ${files.token}. Initialize the home with \`lode home add\` before connecting.`,
    );
  }
  return token;
}

/** One authenticated Status handshake against the endpoint file, or null when
 * no endpoint is published or the daemon behind it is unreachable. Never
 * starts anything. */
export async function probeDaemon(
  selection: HomeSelection,
): Promise<{ client: DesktopClient; status: DaemonStatusView } | null> {
  const files = homeConnectionFiles(selection.path);
  const endpoint = await readTextOrNone(files.endpoint);
  if (!endpoint) {
    return null;
  }
  const token = await readHomeToken(files);
  const client = createDesktopClient(endpoint, token);
  try {
    return { client, status: await client.status() };
  } catch (error) {
    try {
      client.close();
    } catch (cleanupError) {
      const failure = new AggregateError(
        [toError(error), toError(cleanupError)],
        "Daemon probe failed to close its client",
        {
          cause: error,
        },
      );
      throw failure;
    }
    if (error instanceof ConnectError && error.code === Code.Unavailable) {
      return null;
    }
    throw error;
  }
}

/** Resolves a connected client for the Home's daemon, launching it through the
 * provided launcher when no live daemon answers the Status handshake. A stale
 * endpoint file is treated as "not running": only a successful handshake counts. */
export async function ensureRunningDaemon(
  selection: HomeSelection,
  launcher: DaemonLauncher,
  options: DaemonReadinessOptions = {},
): Promise<DesktopClient> {
  await readHomeToken(homeConnectionFiles(selection.path));
  const probe = await probeDaemon(selection);
  if (probe) {
    return probe.client;
  }
  throwIfAborted(options.signal);
  await launcher(selection);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(pollIntervalMs, options.signal);
    const probe = await probeDaemon(selection);
    if (probe) {
      return probe.client;
    }
  }
  throw new Error(`Daemon for home "${selection.name}" did not become ready within ${timeoutMs}ms`);
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }, ms);
    const aborted = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted === true) {
      aborted();
    }
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw abortReason(signal);
  }
}

function abortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("Daemon readiness wait was canceled");
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

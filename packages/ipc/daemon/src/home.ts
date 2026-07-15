// LODE_HOME — the per-user home directory that bundles a daemon's data, identity vault, endpoint,
// and discovery metadata. One home ≈ one daemon (the unit of store isolation). Pure (node builtins
// only): exported via the `@lode/daemon/home` subpath so light clients (app-cli) resolve an endpoint
// without pulling the engine.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, dirname, join } from "node:path";

export type LodeHomePaths = {
  /** The home directory itself. */
  root: string;
  /** Engine data-root (persistence). */
  data: string;
  /** Encrypted identity vault (§2.3). */
  vault: string;
  /** Endpoint string the daemon writes once it is listening. */
  endpoint: string;
  /** Discovery + readiness metadata ({ address, pid, version, startedAt }). */
  daemonJson: string;
  /** Spawn-serialization + liveness lock. */
  daemonLock: string;
  /** Daemon config (unlock TTL policy, §2.2). */
  config: string;
  /** This client install's stable id (generated on first run). */
  clientId: string;
  /** This client's currently active actor id (`actor use`). */
  activeActor: string;
  /** Log directory. */
  logs: string;
};

/** The discovery metadata written to `daemon.json` once the daemon is listening. */
export type DaemonMeta = {
  address: string;
  pid: number;
  version?: string;
  startedAt: number;
};

/** Default home for the platform (Win `%APPDATA%\lode`, macOS `~/Library/Application Support/lode`,
 *  Linux/other-POSIX `${XDG_DATA_HOME:-~/.local/share}/lode`). */
function defaultHome(): string {
  const sys = platform();
  if (sys === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "lode");
  }
  if (sys === "darwin") {
    return join(homedir(), "Library", "Application Support", "lode");
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "lode");
}

/** Resolve the home dir: explicit arg (`--home`) > `LODE_HOME` env > platform default. */
export function resolveLodeHome(argHome?: string): string {
  return argHome ?? process.env.LODE_HOME ?? defaultHome();
}

/** All well-known paths under a home. */
export function homePaths(home: string): LodeHomePaths {
  return {
    root: home,
    data: join(home, "data"),
    vault: join(home, "identity", "vault.json"),
    endpoint: join(home, "endpoint"),
    daemonJson: join(home, "daemon.json"),
    daemonLock: join(home, "daemon.lock"),
    config: join(home, "config.json"),
    clientId: join(home, "client-id"),
    activeActor: join(home, "active-actor"),
    logs: join(home, "logs"),
  };
}

/** The daemon's default endpoint when `--listen` is absent: a Unix domain socket on POSIX, a Windows
 *  named pipe on Win32. `pipe://lode-<sha1(home)[:16]>` keeps each home's pipe name distinct. */
export function defaultEndpoint(home: string): string {
  if (platform() === "win32") {
    const hash = createHash("sha1").update(home).digest("hex").slice(0, 16);
    return `pipe://lode-${hash}`;
  }
  return `unix://${join(home, "daemon.sock")}`;
}

/** For a unix:// endpoint, the on-disk socket path (for stale cleanup); undefined otherwise. */
export function socketPathOf(endpoint: string): string | undefined {
  if (endpoint.startsWith("unix://")) {
    return endpoint.slice("unix://".length);
  }
  return undefined;
}

/** mkdir -p. */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/** Read + JSON.parse a file, or `undefined` if it doesn't exist / is unreadable. */
export async function readJsonMaybe<T>(path: string | URL): Promise<T | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Atomic write: temp file in the same dir → fsync → rename over the target. A crash leaves either
 *  the previous complete file or the new complete file, never a partial write. */
export async function atomicWrite(path: string, data: string): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(tmp, "wx");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
  } catch {
    // Windows rename refuses to overwrite — unlink the stale target first, then rename.
    await unlink(path).catch(() => {});
    await rename(tmp, path);
  }
}

/** Read a small text file, or undefined if missing. */
export async function readTextMaybe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

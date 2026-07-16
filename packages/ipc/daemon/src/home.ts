// LODE_HOME — the per-user home directory that bundles a daemon's data, identity vault, endpoint, and
// discovery metadata. One home ≈ one daemon (the unit of store isolation). This module owns the home's
// PATH LAYOUT only. The crash-safe FS helpers (atomicWrite / readTextMaybe / readJsonMaybe / ensureDir)
// live in the engine's persistence leaf and are re-exported here so the CLI — layered above the daemon
// and structurally unable to depend on @lode/engine — can still reach them through @lode/daemon/home.
// (Endpoint syntax, by contrast, lives in ./endpoint.ts and is reached via @lode/daemon/endpoint.)

import { homedir, platform } from "node:os";
import { join } from "node:path";

// Facade, not a compat shim: the engine owns the atomic-write protocol; the daemon re-exposes it at
// this subpath because app-cli → daemon → engine and app-cli cannot import the engine directly.
export { atomicWrite, ensureDir, readJsonMaybe, readTextMaybe } from "@lode/engine";

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

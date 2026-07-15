import { spawn } from "node:child_process";
import { open, unlink } from "node:fs/promises";
import net from "node:net";
import {
  defaultEndpoint,
  homePaths,
  type LodeHomePaths,
  readTextMaybe,
  resolveLodeHome,
} from "@lode/daemon/home";

export type DaemonEnv = {
  home: string;
  paths: LodeHomePaths;
};

const PROBE_TIMEOUT_MS = 300;
const READY_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 50;

export function resolveDaemonEnv(homeArg?: string): DaemonEnv {
  const home = resolveLodeHome(homeArg);
  return { home, paths: homePaths(home) };
}

/** Resolve the daemon endpoint: explicit `--url`/`LODE_URL` > the home's `endpoint` file > the
 *  platform default (a unix socket / named pipe under the home). */
export async function resolveEndpoint(env: DaemonEnv, explicitUrl?: string): Promise<string> {
  if (explicitUrl !== undefined) {
    return explicitUrl;
  }
  const fromFile = await readTextMaybe(env.paths.endpoint);
  if (fromFile !== undefined) {
    return fromFile.trim();
  }
  return defaultEndpoint(env.home);
}

/** True if something is accepting connections at the endpoint (the daemon is listening). */
export function probeEndpoint(endpoint: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = dial(endpoint);
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/** Resolve + (unless suppressed) auto-spawn the daemon; return the connectable endpoint. */
export async function ensureDaemon(
  env: DaemonEnv,
  options: { explicitUrl?: string; noAutospawn: boolean; lodeEntry: string },
): Promise<string> {
  const endpoint = await resolveEndpoint(env, options.explicitUrl);
  if (await probeEndpoint(endpoint)) {
    return endpoint;
  }
  if (options.noAutospawn) {
    throw new Error(
      `No daemon reachable at ${endpoint}. Run "lode daemon start" or remove --no-autospawn.`,
    );
  }
  await spawnDaemonProcess(env, endpoint, options.lodeEntry, []);
  return endpoint;
}

// The single locked spawn path used by both auto-spawn (ensureDaemon) and `lode daemon start`. The
// first invoker takes daemon.lock (O_EXCL) and brings the daemon up; concurrent invokers see the lock
// held by a live process and just await the endpoint. The spawned child is kept handle-alive (NOT
// unref'd) until it is listening, so a crash during startup rejects immediately instead of hanging on
// the readiness poll; once ready, unref lets the detached daemon survive the client's exit. Returns
// the child pid (undefined if a concurrent invoker won the race and no spawn was needed).
export async function spawnDaemonProcess(
  env: DaemonEnv,
  endpoint: string,
  lodeEntry: string,
  extraArgs: string[],
): Promise<number | undefined> {
  if (await acquireSpawnLock(env)) {
    try {
      if (await probeEndpoint(endpoint)) {
        return undefined;
      }
      const child = spawn(
        process.execPath,
        [lodeEntry, "daemon", "run", "--listen", endpoint, "--home", env.home, ...extraArgs],
        { detached: true, stdio: "ignore" },
      );
      await awaitReady(endpoint, child);
      child.unref();
      return child.pid ?? undefined;
    } finally {
      await releaseSpawnLock(env);
    }
  }
  // Another live process owns the spawn — wait for its daemon, naming the holder on timeout.
  await awaitReady(endpoint);
  return undefined;
}

/** Poll the endpoint until it accepts connections. If `child` is supplied, a startup crash (child exit
 *  before ready) rejects immediately. Without a child (a concurrent invoker waiting on someone else's
 *  spawn) it just polls. */
async function awaitReady(endpoint: string, child?: ReturnType<typeof spawn>): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child !== undefined && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(
        `Daemon exited before becoming ready (code ${child.exitCode} signal ${child.signalCode}).`,
      );
    }
    if (await probeEndpoint(endpoint)) {
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for the daemon at ${endpoint}.`);
}

async function acquireSpawnLock(env: DaemonEnv): Promise<boolean> {
  // Retry once after stealing a dead holder's lock.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(env.paths.daemonLock, "wx");
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      return true;
    } catch {
      const holder = await readTextMaybe(env.paths.daemonLock);
      const pid = holder === undefined ? Number.NaN : Number.parseInt(holder, 10);
      if (Number.isNaN(pid) || !isPidAlive(pid)) {
        // Stale lock (dead holder) — steal it and retry.
        await unlink(env.paths.daemonLock).catch(() => {});
        continue;
      }
      return false;
    }
  }
  return false;
}

async function releaseSpawnLock(env: DaemonEnv): Promise<void> {
  // Only remove the lock if we still own it (avoid clobbering a successor).
  const holder = await readTextMaybe(env.paths.daemonLock);
  if (holder !== undefined && Number.parseInt(holder, 10) === process.pid) {
    await unlink(env.paths.daemonLock).catch(() => {});
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function dial(endpoint: string): net.Socket {
  if (endpoint.startsWith("unix://")) {
    return net.connect(endpoint.slice("unix://".length));
  }
  if (endpoint.startsWith("pipe://")) {
    return net.connect(`\\\\.\\pipe\\${endpoint.slice("pipe://".length)}`);
  }
  const url = new URL(endpoint);
  return net.connect(Number(url.port), url.hostname);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

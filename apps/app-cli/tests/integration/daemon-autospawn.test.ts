import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDaemonEnv, spawnDaemonProcess } from "../../src/daemon-launch.js";

// Exercises the real `lode` dist binary end-to-end: auto-spawn of a UDS daemon, daemon status/stop,
// stale recovery, and spawn serialization under concurrency. Dist must be built (verify builds first).
const LODE_BIN = fileURLToPath(new URL("../../dist/bin/lode.js", import.meta.url));

type RunResult = { stdout: string; stderr: string; code: number };
type DaemonMeta = { address: string; pid: number; version?: string; startedAt: number };

const readMeta = (home: string) =>
  readFile(join(home, "daemon.json"), "utf8").then((raw) => JSON.parse(raw) as DaemonMeta);

function runLode(home: string, args: string[], timeoutMs = 15_000): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [LODE_BIN, ...args], {
      env: { ...process.env, LODE_HOME: home, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

const probe = (path: string) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect(path);
    s.on("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });

const freshHome = () => mkdtemp(join(tmpdir(), "lode-cli-"));

async function stopDaemon(home: string): Promise<void> {
  await runLode(home, ["daemon", "stop"]).catch(() => {});
}

describe("lode CLI auto-spawn + daemon lifecycle", () => {
  let home: string;
  beforeEach(async () => {
    home = await freshHome();
  });
  afterEach(async () => {
    await stopDaemon(home);
    await rm(home, { recursive: true, force: true });
  });

  it("auto-spawns a daemon (no prior daemon) and an open command reaches it over UDS", async () => {
    // `actor list` is an open vault RPC (no unlock/identity needed) that still triggers auto-spawn.
    const res = await runLode(home, ["actor", "list"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("No identities");

    // The auto-spawned daemon is reachable + discovered.
    expect(await probe(join(home, "daemon.sock"))).toBe(true);
    const status = await runLode(home, ["daemon", "status"]);
    expect(status.stdout).toContain("Daemon running");
    const meta = await readMeta(home);
    expect(meta.address).toBe(`unix://${join(home, "daemon.sock")}`);
    expect(meta.pid).toBeGreaterThan(0);
  });

  it("daemon stop tears the daemon down and cleans up the socket + metadata", async () => {
    await runLode(home, ["actor", "list"]);
    expect(await probe(join(home, "daemon.sock"))).toBe(true);
    const stop = await runLode(home, ["daemon", "stop"]);
    expect(stop.stdout).toContain("Daemon stopped");
    // Process gone, metadata + socket removed.
    expect(await probe(join(home, "daemon.sock"))).toBe(false);
    await expect(readFile(join(home, "daemon.json"), "utf8")).rejects.toThrow();
    const status = await runLode(home, ["daemon", "status"]);
    expect(status.stdout).toContain("not running");
  });

  it("recovers from stale metadata + a dead-pid crashed daemon (rebinds the socket)", async () => {
    await runLode(home, ["actor", "list"]);
    const meta = await readMeta(home);
    // Simulate a crash: SIGKILL the daemon so its socket file + daemon.json are left dangling.
    process.kill(meta.pid, "SIGKILL");

    // status sees the stale metadata (socket no longer accepts).
    const status = await runLode(home, ["daemon", "status"]);
    expect(status.stdout).toContain("not running");

    // A command auto-spawns a fresh daemon; runDaemon clears the stale socket and rebinds.
    const fresh = await runLode(home, ["actor", "list"]);
    expect(fresh.code).toBe(0);
    const freshMeta = await readMeta(home);
    expect(freshMeta.pid).not.toBe(meta.pid);
    expect(await probe(join(home, "daemon.sock"))).toBe(true);
  });

  it("serializes concurrent spawns: N parallel commands start exactly one daemon", async () => {
    // Each invocation, finding no daemon, races to spawn one. The lock must serialize them so only
    // one daemon ends up running and the lock is released (not leaked).
    const results = await Promise.all(
      Array.from({ length: 5 }, () => runLode(home, ["actor", "list"])),
    );
    for (const r of results) {
      expect(r.code).toBe(0);
    }
    expect(await probe(join(home, "daemon.sock"))).toBe(true);
    // Exactly one well-formed daemon.json (a second spawn would have left a collision or a leak).
    await readMeta(home);
    // No leaked lock file (the spawner released it once ready).
    await expect(readFile(join(home, "daemon.lock"), "utf8")).rejects.toThrow();
  });

  it("fails fast when the spawned daemon crashes during startup (no 10s hang)", async () => {
    // An unlistable endpoint (missing parent dir) makes runDaemon's listen throw on startup, so the
    // spawned child exits. The spawner keeps the child handle until ready and must reject on that exit
    // immediately, not hang on the readiness poll until its deadline.
    const env = resolveDaemonEnv(home);
    const start = Date.now();
    await expect(
      spawnDaemonProcess(env, "unix:///nonexistent-lode-dir/crash.sock", LODE_BIN, []),
    ).rejects.toThrow(/exited before becoming ready/);
    expect(Date.now() - start).toBeLessThan(8000);
  });
}, 60_000);

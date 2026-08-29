import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { defaultExchangeEndpoint, DesktopPeerTransport, startDaemon, type Daemon } from "@lode/daemon";
import { createEngine, NodePersistenceBackend } from "@lode/engine/host";

import { ensureRunningDaemon, homeConnectionFiles, probeDaemon, selectHome } from "./home-connection.js";

const accessToken = "home-connection-test-token";
const temporaryDirectories: string[] = [];
const runningDaemons: Daemon[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
  await Promise.all(runningDaemons.splice(0).map((daemon) => daemon.stop()));
});

describe("home selection", () => {
  const registry = {
    defaultHome: "main",
    homes: { main: { path: "/srv/lode/personal" }, work: { path: "/mnt/work" } },
  };

  it("resolves --home over LODE_HOME over default_home over main", () => {
    expect(selectHome(registry, "work", undefined)).toEqual({ name: "work", path: "/mnt/work" });
    expect(selectHome(registry, undefined, "work")).toEqual({ name: "work", path: "/mnt/work" });
    expect(selectHome(registry, "main", "work")).toEqual({ name: "main", path: "/srv/lode/personal" });
    expect(selectHome(registry, undefined, undefined)).toEqual({ name: "main", path: "/srv/lode/personal" });
  });

  it("falls back to the literal name `main`, which must still be registered", () => {
    const empty = { homes: {} };
    expect(() => selectHome(empty, undefined, undefined)).toThrow(
      'Home "main" is not registered. No homes are registered yet.',
    );
    expect(() => selectHome(registry, "ghost", undefined)).toThrow(
      'Home "ghost" is not registered. Registered homes: main, work.',
    );
  });
});

describe("home daemon connections", () => {
  it("probe-only answers null without endpoint and never launches", async () => {
    const home = await temporaryHome();
    expect(await probeDaemon({ name: "main", path: home })).toBeNull();
  });

  it("a stale endpoint file is not a running daemon", async () => {
    const home = await temporaryHome();
    await writeFile(join(home, "token"), `${accessToken}\n`, "utf8");
    await writeFile(join(home, "endpoint"), "tcp://127.0.0.1:9\n", "utf8");
    expect(await probeDaemon({ name: "main", path: home })).toBeNull();
  });

  it("does not reinterpret an unreadable endpoint path as a stopped daemon", async () => {
    const home = await temporaryHome();
    await writeFile(join(home, "token"), `${accessToken}\n`, "utf8");
    await mkdir(join(home, "endpoint"));
    await expect(probeDaemon({ name: "main", path: home })).rejects.toThrow(/Cannot read/u);
  });

  it("probe-only connects to a live daemon through its endpoint file", async () => {
    const home = await temporaryHome();
    const daemon = await startHomeDaemon(home);
    const probe = await probeDaemon({ name: "main", path: home });
    expect(probe?.status.homePath).toBe(home);
    expect(probe?.status.ready).toBe(true);
    expect(probe?.status.homeName).toBe("main");
    probe?.client.close();
    await daemon.stop();
  });

  it("ensure-running launches once a daemon is missing and waits for readiness", async () => {
    const home = await temporaryHome();
    await writeFile(join(home, "token"), `${accessToken}\n`, "utf8");
    let launches = 0;
    const client = await ensureRunningDaemon(
      { name: "main", path: home },
      async (selection) => {
        launches += 1;
        const daemon = await startHomeDaemon(selection.path);
        void daemon;
      },
      { timeoutMs: 10_000, pollIntervalMs: 50 },
    );
    expect(launches).toBe(1);
    expect((await client.status()).ready).toBe(true);
    client.close();
  });

  it("ensure-running reuses the running daemon without launching", async () => {
    const home = await temporaryHome();
    const daemon = await startHomeDaemon(home);
    let launches = 0;
    const client = await ensureRunningDaemon(
      { name: "main", path: home },
      () => {
        launches += 1;
      },
      { timeoutMs: 10_000, pollIntervalMs: 50 },
    );
    expect(launches).toBe(0);
    client.close();
    await daemon.stop();
  });

  it("fails with a missing token rather than dialing", async () => {
    const home = await temporaryHome();
    await expect(
      ensureRunningDaemon({ name: "main", path: home }, () => {}, { timeoutMs: 1_000, pollIntervalMs: 20 }),
    ).rejects.toThrow(/no access token/u);
  });
});

async function temporaryHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lode-home-connection-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "data"), { recursive: true });
  return directory;
}

/** Starts an in-process daemon for the home and publishes its runtime files,
 * standing in for what `lode --internal-daemon` does for real. */
async function startHomeDaemon(home: string): Promise<Daemon> {
  await writeFile(join(home, "token"), `${accessToken}\n`, "utf8");
  const listen = "tcp://127.0.0.1:0";
  const peerTransport = new DesktopPeerTransport(defaultExchangeEndpoint(listen));
  const engine = createEngine({
    persistence: new NodePersistenceBackend(join(home, "data")),
    peerTransport,
  });
  await engine.start();
  const daemon = await startDaemon({
    engine,
    listen,
    exchangeAddress: peerTransport.address,
    accessToken,
    status: { homeName: "main", daemonVersion: "test", homePath: home },
  });
  runningDaemons.push(daemon);
  const files = homeConnectionFiles(home);
  await writeFile(files.endpoint, `${daemon.address}\n`, "utf8");
  return daemon;
}

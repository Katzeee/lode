import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { configureLogger } from "@lode/logger";
import { parseUnlockTtl, type StopReport } from "@lode/engine";
import { parseAppServerArgs } from "./app-server-args.js";
import { startAppServerDaemon, startRelayDaemon } from "./app-server-daemon.js";
import {
  atomicWrite,
  type DaemonMeta,
  defaultEndpoint,
  ensureDir,
  homePaths,
  readJsonMaybe,
  resolveLodeHome,
  socketPathOf,
} from "./home.js";

// The foreground daemon entry — the single in-process target of `lode daemon run` (and what auto-spawn
// detaches). Parses argv, starts the engine (or relay-only), owns LODE_HOME discovery metadata
// (endpoint + daemon.json written AFTER listen succeeds), and tears down on `Shutdown` RPC or signal.
// One process: when this resolves, the daemon is done.
export async function runDaemon(argv: string[]): Promise<void> {
  const options = parseAppServerArgs(argv);
  const home = resolveLodeHome(options.home);
  const paths = homePaths(home);
  await ensureDir(paths.data);
  await ensureDir(paths.logs);
  // Default to a rotating file sink so a detached daemon's output (and any startup crash) is
  // diagnosable; `--log-file` overrides the location. Writes alongside stderr.
  configureLogger({ file: { path: options.logFile ?? join(paths.logs, "daemon.log") } });

  // The Shutdown RPC / signals all resolve the same "stop requested" promise; runDaemon blocks on it.
  let resolveStop = () => {};
  const stopped = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => resolveStop());
  }

  const isEngine = options.mode === "engine";
  let address = "";
  let stop: (() => Promise<StopReport>) | undefined;
  let wroteMeta = false;

  try {
    if (isEngine) {
      const listen = options.listen ?? defaultEndpoint(home);
      // A leftover socket file (a prior crash) blocks listen with EADDRINUSE; the spawner's lock
      // serializes instances, so any present file here is stale — clear it.
      const sock = socketPathOf(listen);
      if (sock !== undefined) {
        await unlink(sock).catch(() => {});
      }
      const dataRoot = options.dataRoot ?? paths.data;
      const config = await readJsonMaybe<{ unlockTtl?: string }>(paths.config);
      const vaultTtl =
        config?.unlockTtl === undefined ? undefined : parseUnlockTtl(config.unlockTtl);
      const daemon = await startAppServerDaemon({
        listen,
        dataRoot,
        vaultPath: paths.vault,
        ...(vaultTtl === undefined ? {} : { vaultTtl }),
        ...(options.relay === undefined ? {} : { relay: options.relay }),
        onShutdown: () => resolveStop(),
      });
      address = daemon.address;
      stop = () => daemon.stop();

      const version = await readDaemonVersion();
      const meta: DaemonMeta = {
        address,
        pid: process.pid,
        ...(version === undefined ? {} : { version }),
        startedAt: Date.now(),
      };
      await atomicWrite(paths.endpoint, `${address}\n`);
      await atomicWrite(paths.daemonJson, `${JSON.stringify(meta, null, 2)}\n`);
      wroteMeta = true;
      process.stdout.write(`lode daemon listening on: ${address}\n`);
      if (daemon.relayUrl !== undefined) {
        process.stdout.write(`lode relay listening on: ${daemon.relayUrl}\n`);
      }
    } else {
      const relay = await startRelayDaemon(
        options.relay === undefined ? {} : { relay: options.relay },
      );
      address = relay.relayUrl;
      stop = () => relay.stop();
      process.stdout.write(`lode relay listening on: ${address}\n`);
    }

    await stopped;
  } finally {
    // Always run the engine's managed shutdown — even if start/post-start meta-write threw — so the
    // listener + resources don't linger. Meta cleanup only for what we actually wrote.
    await stop?.();
    if (isEngine && wroteMeta) {
      await cleanupMeta(paths, address);
    }
  }
  process.exit(0);
}

async function cleanupMeta(paths: ReturnType<typeof homePaths>, address: string): Promise<void> {
  await unlink(paths.daemonJson).catch(() => {});
  await unlink(paths.endpoint).catch(() => {});
  const sock = socketPathOf(address);
  if (sock !== undefined) {
    await unlink(sock).catch(() => {});
  }
}

async function readDaemonVersion(): Promise<string | undefined> {
  const pkg = await readJsonMaybe<{ version?: string }>(
    new URL("../package.json", import.meta.url),
  );
  return pkg?.version;
}

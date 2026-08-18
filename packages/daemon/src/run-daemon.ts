import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

import { configureLogger } from "@lode/logger";
import { createEngine } from "@lode/engine/host";
import { startDaemon } from "./daemon.js";
import { defaultEndpoint, socketPathOf } from "./endpoint.js";
import { homePaths, resolveLodeHome } from "./home.js";
import { acquireDaemonLock } from "./daemon-lock.js";
import { parseDaemonArgs } from "./daemon-args.js";

export async function runDaemon(argv: string[]): Promise<void> {
  const options = parseDaemonArgs(argv);
  const home = resolveLodeHome(options.home);
  const paths = homePaths(home);
  await Promise.all([mkdir(paths.data, { recursive: true }), mkdir(paths.logs, { recursive: true })]);
  const listen = options.listen ?? defaultEndpoint(home);
  const accessToken = options.accessToken ?? process.env.LODE_ACCESS_TOKEN ?? (await readHomeToken(paths.token));
  if (!accessToken) {
    throw new Error("Daemon access token is required via --access-token, LODE_ACCESS_TOKEN, or the home token file");
  }
  const lock = await acquireDaemonLock(paths.lock);
  try {
    configureLogger({ file: { path: options.logFile ?? join(paths.logs, "daemon.log") } });
    const socketPath = socketPathOf(listen);
    if (socketPath) {
      await unlink(socketPath).catch(() => {});
    }
    let resolveStop = () => {};
    const stopped = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, resolveStop);
    }
    // Engine creation awaits every cataloged session, so the endpoint below is
    // only published once all workspaces are active or diagnosably faulted.
    const engine = await createEngine({ persistence: { dataRoot: options.dataRoot ?? paths.data } });
    const daemon = await startDaemon({
      engine,
      listen,
      accessToken,
      status: {
        homeName: options.homeName ?? "",
        daemonVersion: daemonVersion(),
        homePath: home,
      },
      onShutdown: resolveStop,
    });
    await writeEndpoint(paths.endpoint, daemon.address);
    process.stdout.write(`lode daemon listening on: ${daemon.address}\n`);
    try {
      await stopped;
    } finally {
      await daemon.stop();
      await unlink(paths.endpoint).catch(() => {});
    }
  } finally {
    await lock.release();
  }
}

async function readHomeToken(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return null;
  }
}

function daemonVersion(): string {
  try {
    const manifest = createRequire(import.meta.url)("../../package.json") as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
}

async function writeEndpoint(path: string, address: string): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${address}\n`);
  try {
    await rename(temporaryPath, path);
  } catch {
    await unlink(path).catch(() => {});
    await rename(temporaryPath, path);
  }
}

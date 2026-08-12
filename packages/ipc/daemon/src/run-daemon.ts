import { unlink } from "node:fs/promises";
import { join } from "node:path";

import { configureLogger } from "@lode/logger";
import { atomicWrite, ensureDir } from "@lode/engine/server";
import { parseAppServerArgs } from "./app-server-args.js";
import { startAppServerDaemon } from "./app-server-daemon.js";
import { defaultEndpoint, socketPathOf } from "./endpoint.js";
import { homePaths, resolveLodeHome } from "./home.js";

export async function runDaemon(argv: string[]): Promise<void> {
  const options = parseAppServerArgs(argv);
  const home = resolveLodeHome(options.home);
  const paths = homePaths(home);
  await ensureDir(paths.data);
  await ensureDir(paths.logs);
  configureLogger({ file: { path: options.logFile ?? join(paths.logs, "daemon.log") } });
  const listen = options.listen ?? defaultEndpoint(home);
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
  const daemon = await startAppServerDaemon({
    listen,
    dataRoot: options.dataRoot ?? paths.data,
    onShutdown: resolveStop,
  });
  await atomicWrite(paths.endpoint, `${daemon.address}\n`);
  process.stdout.write(`lode daemon listening on: ${daemon.address}\n`);
  try {
    await stopped;
  } finally {
    await daemon.stop();
    await unlink(paths.endpoint).catch(() => {});
  }
}

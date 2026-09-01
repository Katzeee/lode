import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { createEngine, NodePersistenceBackend } from "@lode/engine/host";
import { defaultExchangeEndpoint, startDaemon, type Daemon } from "./daemon.js";
import { defaultEndpoint, socketPathOf } from "./endpoint.js";
import { homePaths, resolveLodeHome } from "./home.js";
import { acquireDaemonLock } from "./daemon-lock.js";
import { parseDaemonArgs } from "./daemon-args.js";
import { DesktopPeerTransport } from "./peer-exchange-transport.js";

export async function runDaemon(argv: string[]): Promise<void> {
  const options = parseDaemonArgs(argv);
  const home = resolveLodeHome(options.home);
  const paths = homePaths(home);
  await mkdir(paths.data, { recursive: true });
  const listen = options.listen ?? defaultEndpoint(home);
  const accessToken = options.accessToken ?? process.env.LODE_ACCESS_TOKEN ?? (await readHomeToken(paths.token));
  if (!accessToken) {
    throw new Error("Daemon access token is required via --access-token, LODE_ACCESS_TOKEN, or the home token file");
  }
  const lock = await acquireDaemonLock(paths.lock);
  await withCleanup(
    async () => {
      const socketPath = socketPathOf(listen);
      if (socketPath) {
        await removeIfPresent(socketPath);
      }
      const exchangeListen = options.exchangeListen ?? defaultExchangeEndpoint(listen);
      const exchangeSocketPath = socketPathOf(exchangeListen);
      if (exchangeSocketPath && exchangeSocketPath !== socketPath) {
        await removeIfPresent(exchangeSocketPath);
      }
      let resolveStop = () => {};
      const stopped = new Promise<void>((resolve) => {
        resolveStop = resolve;
      });
      const peerTransport = new DesktopPeerTransport(exchangeListen);
      const engine = createEngine({
        persistence: new NodePersistenceBackend(options.dataRoot ?? paths.data),
        peerTransport,
      });
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.once(signal, resolveStop);
      }
      let daemon: Daemon | undefined;
      let failure: unknown;
      try {
        await engine.start();
        daemon = await startDaemon({
          engine,
          listen,
          exchangeAddress: peerTransport.address,
          accessToken,
          status: {
            homeName: options.homeName ?? "",
            daemonVersion: daemonVersion(),
            homePath: home,
          },
          onShutdown: resolveStop,
        });
        await writeEndpoint(paths.endpoint, daemon.address);
        await writeEndpoint(paths.syncEndpoint, daemon.exchangeAddress);
        process.stdout.write(`lode daemon listening on: ${daemon.address}\n`);
        process.stdout.write(`lode peer exchange listening on: ${daemon.exchangeAddress}\n`);
        await stopped;
      } catch (error) {
        failure = error;
      }
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.off(signal, resolveStop);
      }
      const cleanupErrors: Error[] = [];
      const stop = daemon ? () => daemon.stop() : () => engine.stop();
      await captureCleanup(stop, cleanupErrors);
      await captureCleanup(() => unlink(paths.endpoint), cleanupErrors, "ENOENT");
      await captureCleanup(() => unlink(paths.syncEndpoint), cleanupErrors, "ENOENT");
      if (failure !== undefined) {
        if (cleanupErrors.length > 0) {
          throw new AggregateError([toError(failure), ...cleanupErrors], "Daemon failed and did not clean up fully", {
            cause: failure,
          });
        }
        throw toError(failure);
      }
      if (cleanupErrors.length > 0) {
        if (cleanupErrors.length === 1) {
          throw cleanupErrors[0];
        }
        throw new AggregateError(cleanupErrors, "Daemon failed to stop cleanly");
      }
    },
    lock.release,
    "Daemon run and lock release failed",
  );
}

async function captureCleanup(
  operation: () => void | Promise<void>,
  errors: Error[],
  ignoredCode?: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (ignoredCode && hasCode(error, ignoredCode)) {
      return;
    }
    errors.push(toError(error));
  }
}

function hasCode(value: unknown, code: string): boolean {
  return typeof value === "object" && value !== null && "code" in value && value.code === code;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function readHomeToken(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return null;
    }
    throw new Error(`Cannot read daemon access token at ${path}`, { cause: error });
  }
}

function daemonVersion(): string {
  const manifest = createRequire(import.meta.url)("../package.json") as { version?: unknown };
  if (typeof manifest.version !== "string") {
    throw new Error("Daemon package manifest has no version");
  }
  return manifest.version;
}

async function writeEndpoint(path: string, address: string): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${address}\n`);
    try {
      await rename(temporaryPath, path);
    } catch (error) {
      if (!hasCode(error, "EEXIST") && !hasCode(error, "EPERM")) {
        throw error;
      }
      await removeIfPresent(path);
      await rename(temporaryPath, path);
    }
  } catch (error) {
    try {
      await removeIfPresent(temporaryPath);
    } catch (cleanupError) {
      const failure = new AggregateError(
        [toError(error), toError(cleanupError)],
        "Endpoint publication failed to clean up",
        {
          cause: error,
        },
      );
      throw failure;
    }
    throw error;
  }
}

async function withCleanup(
  operation: () => Promise<void>,
  cleanup: () => void | Promise<void>,
  message: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      const failure = new AggregateError([toError(error), toError(cleanupError)], message, { cause: error });
      throw failure;
    }
    throw error;
  }
  await cleanup();
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) {
      throw error;
    }
  }
}

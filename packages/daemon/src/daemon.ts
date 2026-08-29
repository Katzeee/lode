import type { EngineApi } from "@lode/sdk/host";
import { parseEndpoint } from "@lode/sdk";
import { ConnectServerResource } from "./resources/connect-server-resource.js";
import type { DaemonStatusIdentity } from "./connect-server.js";

export type DaemonOptions = Readonly<{
  engine: Readonly<{ api: EngineApi; stop(): Promise<void> }>;
  listen: string;
  exchangeAddress: string;
  accessToken: string;
  status: DaemonStatusIdentity;
  onShutdown?: () => void;
}>;

export type Daemon = Readonly<{
  address: string;
  /** The remote replica-exchange boundary address to share with other Homes. */
  exchangeAddress: string;
  stop(): Promise<void>;
}>;

/**
 * One daemon, two authorization boundaries: the Home-token control plane and
 * the workspace-scoped peer-exchange plane. They share one Engine but expose
 * disjoint capabilities, so the local control token is never an
 * inter-device credential.
 */
export async function startDaemon(options: DaemonOptions): Promise<Daemon> {
  const control = new ConnectServerResource(
    options.engine.api,
    parseEndpoint(options.listen),
    options.accessToken,
    options.status,
    options.onShutdown,
  );
  try {
    await control.start();
  } catch (error) {
    const cleanup = await Promise.allSettled([control.close(), options.engine.stop()]);
    const cleanupErrors = cleanup.flatMap((result) => (result.status === "rejected" ? [toError(result.reason)] : []));
    if (cleanupErrors.length > 0) {
      throw new AggregateError([toError(error), ...cleanupErrors], "Daemon startup failed to roll back cleanly", {
        cause: error,
      });
    }
    throw error;
  }
  let stopPromise: Promise<void> | undefined;
  return {
    address: control.address,
    exchangeAddress: options.exchangeAddress,
    stop: () => (stopPromise ??= stopDaemon(control, options.engine)),
  };
}

async function stopDaemon(control: ConnectServerResource, engine: Readonly<{ stop(): Promise<void> }>): Promise<void> {
  try {
    await control.close();
  } catch (error) {
    throw new AggregateError([toError(error)], "Daemon failed to stop cleanly", { cause: error });
  }
  try {
    await engine.stop();
  } catch (error) {
    throw new AggregateError([toError(error)], "Daemon failed to stop cleanly", { cause: error });
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * The default exchange endpoint sits beside the control endpoint: same
 * scheme; TCP asks the OS for its own port, sockets/pipes get a
 * `-sync` suffix so the two never collide.
 */
export function defaultExchangeEndpoint(listen: string): string {
  const parsed = parseEndpoint(listen);
  switch (parsed.scheme) {
    case "tcp":
      return `tcp://${parsed.host}:0`;
    case "unix":
      return `unix://${parsed.socketPath}-sync`;
    case "pipe":
      return `pipe://${parsed.pipeName}-sync`;
  }
}

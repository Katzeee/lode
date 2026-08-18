import type { Engine } from "@lode/sdk/host";
import { parseEndpoint } from "./endpoint.js";
import { ConnectServerResource } from "./resources/connect-server-resource.js";
import { PeerExchangeResource } from "./resources/peer-exchange-resource.js";
import type { DaemonStatusIdentity } from "./connect-server.js";

export type DaemonOptions = Readonly<{
  engine: Engine;
  listen: string;
  /** Listener for the remote replica-exchange boundary; defaults to `listen`'s sibling. */
  exchangeListen?: string;
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
  const exchangeEndpoint = parseEndpoint(options.exchangeListen ?? defaultExchangeEndpoint(options.listen));
  const control = new ConnectServerResource(
    options.engine,
    parseEndpoint(options.listen),
    options.accessToken,
    options.status,
    options.onShutdown,
  );
  const exchange = new PeerExchangeResource(options.engine, exchangeEndpoint);
  try {
    await Promise.all([control.start(), exchange.start()]);
  } catch (error) {
    await Promise.allSettled([control.close(), exchange.close(), options.engine.close()]);
    throw error;
  }
  let stopPromise: Promise<void> | undefined;
  return {
    address: control.address,
    exchangeAddress: exchange.address,
    stop: () => (stopPromise ??= stopDaemon(control, exchange, options.engine)),
  };
}

async function stopDaemon(
  control: ConnectServerResource,
  exchange: PeerExchangeResource,
  engine: Engine,
): Promise<void> {
  await Promise.allSettled([control.close(), exchange.close()]);
  await engine.close();
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

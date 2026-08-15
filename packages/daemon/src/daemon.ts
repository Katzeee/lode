import type { Engine } from "@lode/sdk/host";
import { parseEndpoint } from "./endpoint.js";
import { ConnectServerResource } from "./resources/connect-server-resource.js";

export type DaemonOptions = Readonly<{
  engine: Engine;
  listen: string;
  accessToken: string;
  onShutdown?: () => void;
}>;

export type Daemon = Readonly<{
  address: string;
  stop(): Promise<void>;
}>;

export async function startDaemon(options: DaemonOptions): Promise<Daemon> {
  const connect = new ConnectServerResource(
    options.engine,
    parseEndpoint(options.listen),
    options.accessToken,
    options.onShutdown,
  );
  try {
    await connect.start();
  } catch (error) {
    await Promise.allSettled([connect.close(), options.engine.close()]);
    throw error;
  }
  let stopPromise: Promise<void> | undefined;
  return {
    address: connect.address,
    stop: () => (stopPromise ??= stopDaemon(connect, options.engine)),
  };
}

async function stopDaemon(connect: ConnectServerResource, engine: Engine): Promise<void> {
  await connect.close();
  await engine.close();
}

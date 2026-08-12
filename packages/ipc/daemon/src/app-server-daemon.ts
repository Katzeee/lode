import {
  createEngineRuntime,
  type EngineRuntime,
  type PersistenceOptions,
  type StopReport,
} from "@lode/engine/server";
import { parseEndpoint } from "./endpoint.js";
import { ConnectServerResource } from "./resources/connect-server-resource.js";

export type AppServerDaemonOptions = Readonly<{
  listen: string;
  dataRoot?: string;
  persistence?: PersistenceOptions;
  onShutdown?: () => void;
}>;

export type AppServerDaemon = Readonly<{
  address: string;
  stop(): Promise<StopReport>;
}>;

export async function startAppServerDaemon(
  options: AppServerDaemonOptions,
): Promise<AppServerDaemon> {
  const persistence =
    options.persistence ?? (options.dataRoot ? { dataRoot: options.dataRoot } : undefined);
  const runtime: EngineRuntime = await createEngineRuntime({
    ...(persistence ? { persistence } : {}),
  });
  const connect = runtime.app.root.own(
    new ConnectServerResource(runtime, parseEndpoint(options.listen), options.onShutdown),
  );
  await runtime.app.start();
  return { address: connect.address, stop: () => runtime.app.stop() };
}

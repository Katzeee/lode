import { createAppRuntime, type AppRuntime, type PersistenceOptions } from "@lode/engine";
import { createLodeServer } from "./connect-server.js";
import { parseListenUrl } from "./listen-url.js";

export type AppServerDaemonOptions = {
  listen: string;
  dataRoot?: string;
  persistence?: PersistenceOptions;
};

export type AppServerDaemon = {
  address: string;
  stop(): Promise<void>;
};

// Hosts the engine as a local gRPC (HTTP/2, h2c) daemon: creates the Connect server,
// binds the engine's LodeCommands handlers, and assigns one connectionId per TCP session.
// Mirrors anytype-heart's cmd/grpcserver — a thin process shell around createAppRuntime().
export async function startAppServerDaemon(
  options: AppServerDaemonOptions,
): Promise<AppServerDaemon> {
  const { host, port } = parseListenUrl(options.listen);
  const persistence =
    options.persistence ?? (options.dataRoot ? { dataRoot: options.dataRoot } : undefined);
  const runtime: AppRuntime = await createAppRuntime(persistence ? { persistence } : {});
  const { server, closeConnections } = createLodeServer(runtime);

  await new Promise<void>((resolve) => {
    server.listen({ host, port }, () => resolve());
  });
  const boundPort = (server.address() as { port: number }).port;
  const address = `http://${host}:${boundPort}`;

  return {
    address,
    stop: async () => {
      // Destroy open HTTP/2 sessions so server.close() doesn't hang on connected clients
      // (their session 'close' fires removeConnection on the engine).
      closeConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await runtime.close();
    },
  };
}

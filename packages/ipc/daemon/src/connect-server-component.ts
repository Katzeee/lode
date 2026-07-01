import type { AppRuntime, Component } from "@lode/engine";
import { createLodeServer } from "./connect-server.js";
import type { SyncHandlers } from "./sync-handlers.js";

/**
 * Hosts the gRPC (HTTP/2, h2c) Connect server as an App `Component`. Wraps `createLodeServer`
 * (which binds the engine's LodeCommands handlers and assigns one connectionId per HTTP/2 session).
 * The bound port is ephemeral until `listen()` resolves, so `address` is readable only after
 * `start()`. Registered before the relay/sync runner so it stops after they drain (reverse teardown).
 */
export class ConnectServerComponent implements Component {
  readonly name = "connect-server";
  private readonly runtime: AppRuntime;
  private readonly host: string;
  private readonly port: number;
  private readonly syncHandlers: SyncHandlers;
  private server?: ReturnType<typeof createLodeServer>["server"];
  private closeConnections: () => void = () => {};
  private boundPort = 0;

  constructor(runtime: AppRuntime, host: string, port: number, syncHandlers: SyncHandlers) {
    this.runtime = runtime;
    this.host = host;
    this.port = port;
    this.syncHandlers = syncHandlers;
  }

  /** The daemon's gRPC URL (`http://host:port`); readable after `start()`. */
  get address(): string {
    return `http://${this.host}:${this.boundPort}`;
  }

  async start(): Promise<void> {
    const { server, closeConnections } = createLodeServer(this.runtime, this.syncHandlers);
    this.server = server;
    this.closeConnections = closeConnections;
    await new Promise<void>((resolve) => {
      server.listen({ host: this.host, port: this.port }, () => resolve());
    });
    this.boundPort = (server.address() as { port: number }).port;
  }

  async stop(): Promise<void> {
    // Destroy open HTTP/2 sessions so server.close() doesn't hang on connected clients (their
    // session 'close' fires removeConnection on the engine).
    this.closeConnections();
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

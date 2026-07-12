import type { EngineRuntime, RuntimeResource } from "@lode/engine";
import { createLodeServer } from "../connect-server.js";

/**
 * Hosts the gRPC (HTTP/2, h2c) Connect server as a managed resource. Wraps `createLodeServer`
 * (which binds the engine's LodeCommands handlers and assigns one connectionId per HTTP/2 session).
 * The bound port is ephemeral until `listen()` resolves, so `address` is readable only after
 * `start()`. Quiesce closes listener admission while existing connections drain; dispose then closes
 * any remaining connections.
 */
export class ConnectServerResource implements RuntimeResource {
  readonly id = "connect-server";
  private readonly runtime: EngineRuntime;
  private readonly host: string;
  private readonly port: number;
  private server?: ReturnType<typeof createLodeServer>["server"];
  private closeConnections: () => void = () => {};
  private boundPort = 0;
  private closePromise?: Promise<void>;

  constructor(runtime: EngineRuntime, host: string, port: number) {
    this.runtime = runtime;
    this.host = host;
    this.port = port;
  }

  /** The daemon's gRPC URL (`http://host:port`); readable after `start()`. */
  get address(): string {
    return `http://${this.host}:${this.boundPort}`;
  }

  async start(): Promise<void> {
    const { server, closeConnections } = createLodeServer(this.runtime);
    this.server = server;
    this.closeConnections = closeConnections;
    await new Promise<void>((resolve) => {
      server.listen({ host: this.host, port: this.port }, () => resolve());
    });
    this.boundPort = (server.address() as { port: number }).port;
  }

  quiesce(): void {
    this.closePromise ??= new Promise<void>((resolve, reject) => {
      this.server?.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async release(): Promise<void> {
    this.closeConnections();
    this.quiesce();
    await this.closePromise;
  }
}

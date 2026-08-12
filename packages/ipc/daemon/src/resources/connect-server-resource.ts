import { chmod } from "node:fs/promises";
import type { EngineRuntime, RuntimeResource } from "@lode/engine/server";
import { canonicalAddress, type ParsedEndpoint, listenTarget } from "../endpoint.js";
import { createLodeServer } from "../connect-server.js";

/**
 * Hosts the gRPC (HTTP/2, h2c) Connect server as a managed resource. Wraps `createLodeServer`
 * (which binds the engine's LodeCommands handlers and assigns one connectionId per HTTP/2 session).
 * Listens on a Unix domain socket / Windows named pipe / TCP loopback. The bound port is ephemeral
 * until `listen()` resolves for TCP, so `address` is readable only after `start()`. Unix sockets are
 * chmod'd 0600 so only the OS user can reach the daemon. Quiesce closes listener admission while
 * existing connections drain; dispose then closes any remaining connections.
 */
export class ConnectServerResource implements RuntimeResource {
  readonly id = "connect-server";
  private readonly runtime: EngineRuntime;
  private readonly endpoint: ParsedEndpoint;
  private readonly onShutdown?: () => void;
  private server?: ReturnType<typeof createLodeServer>["server"];
  private closeConnections: () => void = () => {};
  private boundPort = 0;
  private closePromise?: Promise<void>;

  constructor(runtime: EngineRuntime, endpoint: ParsedEndpoint, onShutdown?: () => void) {
    this.runtime = runtime;
    this.endpoint = endpoint;
    this.onShutdown = onShutdown;
  }

  /** The daemon's endpoint string (the canonical URL written to `LODE_HOME/endpoint`). */
  get address(): string {
    return canonicalAddress(this.endpoint, this.boundPort);
  }

  async start(): Promise<void> {
    const { server, closeConnections } = createLodeServer(this.runtime, this.onShutdown);
    this.server = server;
    this.closeConnections = closeConnections;
    await new Promise<void>((resolve) => {
      server.listen(listenTarget(this.endpoint), () => resolve());
    });
    if (this.endpoint.scheme === "tcp") {
      this.boundPort = (server.address() as { port: number }).port;
    } else if (this.endpoint.scheme === "unix") {
      // Restrict the socket to the OS user — it is the auth boundary for the open `Shutdown` RPC.
      await chmod(this.endpoint.socketPath, 0o600).catch(() => {
        // Best-effort: a missing file (listener race) is harmless.
      });
    }
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

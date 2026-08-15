import { chmod } from "node:fs/promises";
import type { Engine } from "@lode/sdk/host";
import { canonicalAddress, type ParsedEndpoint, listenTarget } from "../endpoint.js";
import { createLodeServer } from "../connect-server.js";

/** Hosts the daemon's generated services without joining their lifecycle to the Engine internals. */
export class ConnectServerResource {
  private readonly engine: Engine;
  private readonly endpoint: ParsedEndpoint;
  private readonly accessToken: string;
  private readonly onShutdown?: () => void;
  private server?: ReturnType<typeof createLodeServer>["server"];
  private closeConnections: () => void = () => {};
  private boundPort = 0;
  private closePromise?: Promise<void>;

  constructor(engine: Engine, endpoint: ParsedEndpoint, accessToken: string, onShutdown?: () => void) {
    this.engine = engine;
    this.endpoint = endpoint;
    this.accessToken = accessToken;
    this.onShutdown = onShutdown;
  }

  /** The daemon's endpoint string (the canonical URL written to `LODE_HOME/endpoint`). */
  get address(): string {
    return canonicalAddress(this.endpoint, this.boundPort);
  }

  async start(): Promise<void> {
    const { server, closeConnections } = createLodeServer(this.engine, this.accessToken, this.onShutdown);
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

  private quiesce(): void {
    if (!this.server) {
      this.closePromise ??= Promise.resolve();
      return;
    }
    const server = this.server;
    this.closePromise ??= new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async close(): Promise<void> {
    this.closeConnections();
    this.quiesce();
    await this.closePromise;
  }
}

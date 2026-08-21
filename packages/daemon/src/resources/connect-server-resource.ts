import { chmod } from "node:fs/promises";
import type { EngineApi } from "@lode/sdk/host";
import { canonicalAddress, type ParsedEndpoint, listenTarget } from "../endpoint.js";
import { createLodeServer, type DaemonStatusIdentity } from "../connect-server.js";

/** Hosts the daemon's generated services without joining their lifecycle to the Engine internals. */
export class ConnectServerResource {
  private readonly engine: EngineApi;
  private readonly endpoint: ParsedEndpoint;
  private readonly accessToken: string;
  private readonly status: DaemonStatusIdentity;
  private readonly onShutdown?: () => void;
  private server?: ReturnType<typeof createLodeServer>["server"];
  private closeConnections: () => void = () => {};
  private boundPort = 0;

  constructor(
    engine: EngineApi,
    endpoint: ParsedEndpoint,
    accessToken: string,
    status: DaemonStatusIdentity,
    onShutdown?: () => void,
  ) {
    this.engine = engine;
    this.endpoint = endpoint;
    this.accessToken = accessToken;
    this.status = status;
    this.onShutdown = onShutdown;
  }

  /** The daemon's endpoint string (the canonical URL written to `LODE_HOME/endpoint`). */
  get address(): string {
    return canonicalAddress(this.endpoint, this.boundPort);
  }

  async start(): Promise<void> {
    if (this.server) {
      throw new Error("Daemon Client Session listener is already started");
    }
    const { server, closeConnections } = createLodeServer(this.engine, this.accessToken, this.status, this.onShutdown);
    this.server = server;
    this.closeConnections = closeConnections;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(listenTarget(this.endpoint), () => {
          server.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      if (this.server === server) {
        this.server = undefined;
        this.closeConnections = () => {};
      }
      throw error;
    }
    if (this.endpoint.scheme === "tcp") {
      this.boundPort = (server.address() as { port: number }).port;
    } else if (this.endpoint.scheme === "unix") {
      // Restrict the socket to the OS user — it is the auth boundary for the open `Shutdown` RPC.
      await chmod(this.endpoint.socketPath, 0o600).catch(() => {
        // Best-effort: a missing file (listener race) is harmless.
      });
    }
  }

  /** Revokes owned Client Sessions before closing the listener, so no call can outlive the Engine it targets. */
  async close(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }
    this.server = undefined;
    const closeConnections = this.closeConnections;
    this.closeConnections = () => {};
    let failure: Error | undefined;
    try {
      closeConnections();
    } catch (error) {
      failure = toError(error);
    }
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    } catch (error) {
      failure ??= toError(error);
    }
    if (failure) {
      throw failure;
    }
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

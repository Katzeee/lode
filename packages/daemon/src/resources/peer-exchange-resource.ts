import { chmod } from "node:fs/promises";
import type { Engine } from "@lode/sdk/host";
import { canonicalAddress, type ParsedEndpoint, listenTarget } from "../endpoint.js";
import { createPeerExchangeServer } from "../peer-exchange-server.js";

/**
 * Hosts the remote replica-exchange boundary. Every request authenticates as
 * an admitted Peer of one workspace — there is no Home token on this
 * listener, and its endpoint is the only address meant to leave the machine.
 */
export class PeerExchangeResource {
  private server?: ReturnType<typeof createPeerExchangeServer>["server"];
  private boundPort = 0;
  private closePromise?: Promise<void>;

  constructor(
    private readonly engine: Engine,
    private readonly endpoint: ParsedEndpoint,
  ) {}

  /** The exchange endpoint string (the canonical URL written to `LODE_HOME/sync-endpoint`). */
  get address(): string {
    return canonicalAddress(this.endpoint, this.boundPort);
  }

  async start(): Promise<void> {
    const { server } = createPeerExchangeServer(this.engine);
    this.server = server;
    await new Promise<void>((resolve) => {
      server.listen(listenTarget(this.endpoint), () => resolve());
    });
    if (this.endpoint.scheme === "tcp") {
      this.boundPort = (server.address() as { port: number }).port;
    } else if (this.endpoint.scheme === "unix") {
      // The proof-of-possession handshake is the auth boundary, but keep the
      // socket private to the OS user like every other home socket.
      await chmod(this.endpoint.socketPath, 0o600).catch(() => {});
    }
  }

  close(): Promise<void> {
    if (!this.server) {
      this.closePromise ??= Promise.resolve();
      return this.closePromise;
    }
    const server = this.server;
    this.closePromise ??= new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    return this.closePromise;
  }
}

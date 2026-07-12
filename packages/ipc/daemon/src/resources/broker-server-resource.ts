import { type RuntimeResource, BrokerServer } from "@lode/engine";

/**
 * Hosts the workspace-routing broker (the relay) as a managed resource (design sync-design.md §3).
 * The relay is a stateless coordinate — content-blind, no-auth, no storage, served as a Connect gRPC
 * `BrokerService` over HTTP/2. Bind is async, so `start()` awaits `ready()`; `url` is readable only
 * after `start()` (the port is ephemeral until bound).
 */
export type BrokerServerResourceOptions = {
  /** Bind port; 0 (default) = ephemeral. */
  readonly port?: number;
  /** Bind host; default 127.0.0.1. */
  readonly host?: string;
  /** Optional TLS cert (PEM). With `tlsKey`, the relay serves gRPC over h2+TLS (`https://`); without
   *  it, plaintext h2c (`http://`) — the default. TLS termination is the deployer's concern (a reverse
   *  proxy like Caddy is the usual shape); this hook is the opt-in for users who want TLS at the relay. */
  readonly tlsCert?: string;
  /** Optional TLS key (PEM), paired with `tlsCert`. */
  readonly tlsKey?: string;
};

export class BrokerServerResource implements RuntimeResource {
  readonly id = "relay";
  private readonly server: BrokerServer;
  private readonly host: string;
  private readonly secure: boolean;

  constructor(opts: BrokerServerResourceOptions = {}) {
    this.host = opts.host ?? "127.0.0.1";
    this.secure = opts.tlsCert !== undefined && opts.tlsKey !== undefined;
    this.server = new BrokerServer({
      port: opts.port,
      host: this.host,
      ...(opts.tlsCert === undefined ? {} : { tlsCert: opts.tlsCert }),
      ...(opts.tlsKey === undefined ? {} : { tlsKey: opts.tlsKey }),
    });
  }

  /** The relay's URL — `http://host:port` (plaintext h2c) or `https://host:port` (h2+TLS); readable
   *  after `start()`. */
  get url(): string {
    return `${this.secure ? "https" : "http"}://${this.host}:${this.server.port}`;
  }

  async start(): Promise<void> {
    await this.server.ready();
  }

  async release(): Promise<void> {
    await this.server.close();
  }
}

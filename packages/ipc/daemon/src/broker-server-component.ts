import type { Component } from "@lode/engine";
import { BrokerServer } from "@lode/sync";

/**
 * Hosts the workspace-routing broker (the relay) as an App `Component` (design sync-design.md §3).
 * The relay is a stateless coordinate — content-blind, no-auth, no storage. Bind is async, so
 * `start()` awaits `ready()`; `url` is readable only after `start()` (the port is ephemeral until
 * bound). Registered before the sync runner so it stops after it (reverse teardown).
 */
export type BrokerServerComponentOptions = {
  /** Bind port; 0 (default) = ephemeral. */
  readonly port?: number;
  /** Bind host; default 127.0.0.1. */
  readonly host?: string;
};

export class BrokerServerComponent implements Component {
  readonly name = "relay";
  private readonly server: BrokerServer;
  private readonly host: string;

  constructor(opts: BrokerServerComponentOptions = {}) {
    this.host = opts.host ?? "127.0.0.1";
    this.server = new BrokerServer({ port: opts.port, host: this.host });
  }

  /** The relay's WebSocket URL (`ws://host:port`); readable after `start()`. */
  get url(): string {
    return `ws://${this.host}:${this.server.port}`;
  }

  async start(): Promise<void> {
    await this.server.ready();
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}

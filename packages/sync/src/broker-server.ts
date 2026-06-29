import { WebSocketServer, type WebSocket } from "ws";
import { createBroker, type Broker, type BrokerPeer } from "./broker.js";
import { decodeFrame, encodeFrame } from "./frame.js";

/**
 * The broker WebSocket SERVER — the production relay's core (design sync-design.md §3). Hosts the
 * routing core (`broker.ts`): each accepted connection becomes a `BrokerPeer`; client frames drive
 * subscribe/unsubscribe/publish; routed publishes come back as `deliver` frames. The daemon hosts
 * this in `--relay` mode (T4); mobile/other daemons dial it via `BrokerClient`.
 *
 * Content-blind: payloads are forwarded as-is, never decoded. No auth: the only rule is the routing
 * invariant "publisher must be subscribed" (enforced in the core). `listen()` is async, so `ready()`
 * resolves once the bound port is known — await it before reading `port`.
 */

export type BrokerServerOptions = {
  /** Bind port; 0 (default) = ephemeral. */
  readonly port?: number;
  /** Bind host; default 127.0.0.1 (loopback — the relay is user-deployed; reachability is §3a). */
  readonly host?: string;
};

export class BrokerServer {
  private readonly wss: WebSocketServer;
  private readonly broker: Broker;
  private nextId = 0;
  private boundPort = 0;

  constructor(opts: BrokerServerOptions = {}) {
    this.broker = createBroker();
    this.wss = new WebSocketServer({ port: opts.port ?? 0, host: opts.host ?? "127.0.0.1" });
    // A server-level error (e.g. EADDRINUSE on a fixed port) must never crash the relay — Node
    // throws on an unhandled 'error'. Swallow here; T4 surfaces it via the daemon.
    this.wss.on("error", () => {
      // no-op
    });
    this.wss.on("listening", () => {
      const addr = this.wss.address();
      if (typeof addr === "object" && addr !== null) {
        this.boundPort = addr.port;
      }
    });
    this.wss.on("connection", (sock) => {
      this.handle(sock);
    });
  }

  /** The bound port. 0 until `ready()` resolves (listen is async). */
  get port(): number {
    return this.boundPort;
  }

  /** Resolve once the server is bound and `port` is known. Race-free: registers the listener before
   *  re-checking the bound flag, so a 'listening' that already fired can't strand the awaiter. */
  ready(): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        this.wss.off("listening", done);
        resolve();
      };
      this.wss.on("listening", done);
      if (this.boundPort > 0) {
        done();
      }
    });
  }

  private handle(sock: WebSocket): void {
    const id = `c${this.nextId++}`;
    const peer: BrokerPeer = {
      id,
      deliver: (wsId, payload) => {
        if (sock.readyState === sock.OPEN) {
          sock.send(encodeFrame({ kind: "deliver", wsId, payload }));
        }
      },
    };
    this.broker.connect(peer);
    sock.on("message", (data) => {
      const frame = safeDecode(data);
      if (!frame) {
        return; // drop malformed/garbage — the broker never aborts on a bad frame
      }
      switch (frame.kind) {
        case "subscribe":
          this.broker.subscribe(id, frame.wsId);
          break;
        case "unsubscribe":
          this.broker.unsubscribe(id, frame.wsId);
          break;
        case "publish":
          // A non-subscriber publish throws in the core; swallow it (routing rule, not a crash).
          try {
            this.broker.publish(id, frame.wsId, frame.payload);
          } catch {
            // sender not subscribed — ignore
          }
          break;
        case "deliver":
          // Clients must not send `deliver`; ignore.
          break;
      }
    });
    const cleanup = (): void => this.broker.disconnect(id);
    sock.on("close", cleanup);
    sock.on("error", cleanup);
  }

  /** Stop listening and tear down all live connections. Resolves once the server is closed. */
  close(): Promise<void> {
    for (const c of this.wss.clients) {
      c.terminate();
    }
    return new Promise((resolve) => {
      this.wss.close(() => {
        resolve();
      });
    });
  }
}

function safeDecode(data: unknown): ReturnType<typeof decodeFrame> | undefined {
  try {
    return decodeFrame(Buffer.from(data as Uint8Array));
  } catch {
    return undefined;
  }
}

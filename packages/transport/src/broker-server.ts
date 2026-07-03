import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { WebSocketServer, type WebSocket } from "ws";
import { type BrokerFrame, BrokerFrameSchema } from "@lode/protocol/proto";
import { createBroker, type Broker, type BrokerPeer } from "./broker.js";

/**
 * The broker WebSocket SERVER — the production relay's core (design sync-design.md §3). Hosts the
 * routing core (`broker.ts`): each accepted connection becomes a `BrokerPeer`; client frames drive
 * subscribe/unsubscribe/publish; routed publishes come back as `deliver` frames. The daemon hosts
 * this in `--relay` mode; mobile/other daemons dial it via `BrokerClient`.
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
  private bindError: Error | null = null;

  constructor(opts: BrokerServerOptions = {}) {
    this.broker = createBroker();
    this.wss = new WebSocketServer({ port: opts.port ?? 0, host: opts.host ?? "127.0.0.1" });
    // A permanent listener keeps Node from throwing on an unhandled 'error' (a server-level error
    // such as EADDRINUSE on a fixed port). Store it so ready() can reject instead of hanging forever.
    this.wss.on("error", (err: Error) => {
      this.bindError = err;
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

  /** Resolve once the server is bound and `port` is known; reject on a bind error (e.g. EADDRINUSE).
   *  Race-free: registers both listeners before re-checking the flags. */
  ready(): Promise<void> {
    if (this.boundPort > 0) {
      return Promise.resolve();
    }
    if (this.bindError !== null) {
      return Promise.reject(this.bindError);
    }
    return new Promise<void>((resolve, reject) => {
      const onListening = (): void => {
        cleanup();
        resolve();
      };
      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };
      const cleanup = (): void => {
        this.wss.off("listening", onListening);
        this.wss.off("error", onError);
      };
      this.wss.once("listening", onListening);
      this.wss.once("error", onError);
    });
  }

  private handle(sock: WebSocket): void {
    const id = `c${this.nextId++}`;
    const peer: BrokerPeer = {
      id,
      deliver: (wsId, payload) => {
        if (sock.readyState === sock.OPEN) {
          sock.send(
            toBinary(
              BrokerFrameSchema,
              create(BrokerFrameSchema, {
                kind: { case: "deliver", value: { wsId, payload } },
              }),
            ),
          );
        }
      },
    };
    this.broker.connect(peer);
    sock.on("message", (data) => {
      const frame = safeDecode(data);
      if (!frame) {
        return; // drop malformed/garbage — the broker never aborts on a bad frame
      }
      const k = frame.kind;
      switch (k.case) {
        case "subscribe":
          // peerId (optional, per-dataRoot) opts the peer into directed delivery + the peers() list.
          this.broker.subscribe(id, k.value.wsId, k.value.peerId || undefined);
          break;
        case "unsubscribe":
          this.broker.unsubscribe(id, k.value.wsId);
          break;
        case "publish":
          // A non-subscriber publish throws in the core; swallow it (routing rule, not a crash).
          try {
            this.broker.publish(id, k.value.wsId, k.value.payload, k.value.toPeerId || undefined);
          } catch {
            // sender not subscribed — ignore
          }
          break;
        case "peersReq": {
          // Discovery (§3c). The relay answers every request (never a silent drop — a no-answer is
          // indistinguishable from a dead relay), but a NON-subscriber gets an empty roster: a peer may
          // only learn the members of a channel it belongs to (workspace isolation — a ws1 peer must
          // not enumerate ws2's peers). peerIds are non-secret *within* a workspace, but their existence
          // and channel-association are not.
          const wsId = k.value.wsId;
          const peerIds = this.broker.isSubscribed(id, wsId) ? this.broker.peers(wsId) : [];
          sock.send(
            toBinary(
              BrokerFrameSchema,
              create(BrokerFrameSchema, {
                kind: { case: "peersResp", value: { wsId, peerIds } },
              }),
            ),
          );
          break;
        }
        case "deliver":
        case "peersResp":
        case undefined:
          // Clients must not send `deliver` or `peersResp` (server-only frames); unset kind is garbage.
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

function safeDecode(data: unknown): BrokerFrame | undefined {
  try {
    return fromBinary(BrokerFrameSchema, Buffer.from(data as Uint8Array));
  } catch {
    return undefined;
  }
}

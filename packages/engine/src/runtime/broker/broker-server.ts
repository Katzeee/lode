import http2 from "node:http2";
import { create } from "@bufbuild/protobuf";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { BrokerService, type BrokerFrame, BrokerFrameSchema } from "@lode/protocol/proto";
import { createLogger } from "@lode/logger";
import { createBroker, type Broker, type BrokerPeer } from "./broker.js";
import { BoundedAsyncQueue } from "./bounded-async-queue.js";

const log = createLogger("engine.broker.server");

/** Approximate wire size of a frame (payload + small overhead) — the bound for the send queue. */
const frameBytes = (f: BrokerFrame): number => {
  const k = f.kind;
  if ((k.case === "publish" || k.case === "deliver") && k.value.payload !== undefined) {
    return k.value.payload.length + 64;
  }
  return 64;
};

/** Per-connection send-buffer cap — generous for normal burst (a Loro update blob is KB–MB), tight
 *  enough that a wedged peer can't leak the relay to OOM. */
const DEFAULT_MAX_SEND_BUFFERED_BYTES = 4 * 1024 * 1024;

/**
 * The broker relay — the production relay's core (design sync-design.md §3), now hosted as a Connect
 * gRPC `BrokerService.BrokerStream` bidi RPC over HTTP/2 (h2c plaintext by default; h2+TLS when
 * `tlsCert`/`tlsKey` are provided). Each bidi call is one peer connection: incoming frames drive the
 * routing core (`broker.ts`); the core's `deliver`/the server's `peersResp` stream back as outgoing
 * frames. The daemon hosts this in `--relay` mode; mobile/other daemons dial it via `BrokerClient`.
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
  /** Optional TLS cert (PEM). With `tlsKey`, serves gRPC over h2+TLS; otherwise h2c plaintext. */
  readonly tlsCert?: string;
  /** Optional TLS key (PEM), paired with `tlsCert`. */
  readonly tlsKey?: string;
};

export class BrokerServer {
  private readonly broker: Broker;
  private readonly server: http2.Http2Server | http2.Http2SecureServer;
  private readonly active = new Set<BoundedAsyncQueue<BrokerFrame>>();
  private nextId = 0;
  private boundPort = 0;
  private bindError: Error | null = null;

  constructor(opts: BrokerServerOptions = {}) {
    this.broker = createBroker();
    const handler = connectNodeAdapter({
      grpc: true,
      routes: (router) =>
        router.service(BrokerService, {
          // One bidi call per peer. The impl signature allows omitting context (fewer params).
          brokerStream: (requests: AsyncIterable<BrokerFrame>) => this.handleStream(requests),
        }),
    });
    const secure = opts.tlsCert !== undefined && opts.tlsKey !== undefined;
    this.server = secure
      ? http2.createSecureServer({ cert: opts.tlsCert, key: opts.tlsKey }, handler)
      : http2.createServer({}, handler);
    // A permanent listener keeps Node from throwing on a server-level error (EADDRINUSE on a fixed
    // port); ready() registers its own once-listeners to resolve/reject.
    this.server.on("error", (err: Error) => {
      this.bindError = err;
    });
    this.server.on("listening", () => {
      const addr = this.server.address();
      if (typeof addr === "object" && addr !== null) {
        this.boundPort = addr.port;
      }
    });
    // Bind eagerly (listen is async) so ready() can observe the bound port.
    this.server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1");
  }

  /** The bound port. 0 until `ready()` resolves. */
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
        this.server.off("listening", onListening);
        this.server.off("error", onError);
      };
      this.server.once("listening", onListening);
      this.server.once("error", onError);
    });
  }

  /** One bidi stream = one peer connection. Drive incoming frames through the routing core; stream
   *  the core's `deliver` (and this server's `peersResp`) back as outgoing. Cleanup on either the
   *  client disconnecting (request stream ends) or Connect abandoning the response. */
  private async *handleStream(requests: AsyncIterable<BrokerFrame>): AsyncIterable<BrokerFrame> {
    const id = `c${this.nextId++}`;
    const out = new BoundedAsyncQueue<BrokerFrame>(
      DEFAULT_MAX_SEND_BUFFERED_BYTES,
      frameBytes,
      (frame, bytes, buffered) => {
        log.warn("broker send buffer over cap; dropping frame", {
          kind: frame.kind.case,
          wsId: frame.kind.value?.wsId,
          connId: id,
          frameBytes: bytes,
          buffered,
          max: DEFAULT_MAX_SEND_BUFFERED_BYTES,
        });
      },
    );
    this.active.add(out);
    const peer: BrokerPeer = {
      id,
      deliver: (wsId, payload, fromPeerId) =>
        out.push(
          create(BrokerFrameSchema, {
            kind: { case: "deliver", value: { wsId, payload, fromPeerId } },
          }),
        ),
    };
    this.broker.connect(peer);
    // Consume incoming in parallel with yielding outgoing. Fire-and-forget — it has its own
    // try/catch (never rejects) and closes `out` in its finally when the client's request stream
    // ends (clean disconnect). NOT awaited: on a server-initiated close the request stream is still
    // open, so awaiting would deadlock the response teardown.
    void (async () => {
      try {
        for await (const frame of requests) {
          this.route(id, frame, out);
        }
      } catch (err) {
        // Request stream canceled/errored (client disconnect mid-frame) — treat as a disconnect.
        log.debug("broker client stream ended", { connId: id, err });
      } finally {
        out.close();
      }
    })();
    try {
      yield* out;
    } finally {
      this.broker.disconnect(id);
      this.active.delete(out);
      out.close();
      // `consume` is fire-and-forget — it has its own try/catch (never rejects) and settles when the
      // client's request stream ends. We deliberately do NOT await it here: on a server-initiated
      // close (relay shutdown) the request stream is still open, so awaiting would deadlock the
      // response teardown and the client would never see the stream end.
    }
  }

  /** Dispatch one incoming client frame into the routing core (subscribe/unsubscribe/publish) or
   *  answer it directly (peersReq → peersResp). Server-only frames (deliver/peersResp) from a client
   *  are ignored. */
  private route(id: string, frame: BrokerFrame, out: BoundedAsyncQueue<BrokerFrame>): void {
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
        } catch (err) {
          log.debug("publish from non-subscriber ignored", { wsId: k.value.wsId, connId: id, err });
        }
        break;
      case "peersReq": {
        // Discovery (§3c). A NON-subscriber gets an empty roster: a peer may only learn the members
        // of a channel it belongs to (workspace isolation — a ws1 peer must not enumerate ws2).
        const wsId = k.value.wsId;
        const peerIds = this.broker.isSubscribed(id, wsId) ? this.broker.peers(wsId) : [];
        out.push(
          create(BrokerFrameSchema, { kind: { case: "peersResp", value: { wsId, peerIds } } }),
        );
        break;
      }
      case "deliver":
      case "peersResp":
      case undefined:
        // Clients must not send deliver/peersResp (server-only frames); empty kind is garbage.
        break;
    }
  }

  /** Stop listening + tear down every live peer (each sees its response stream end → disconnect). */
  async close(): Promise<void> {
    for (const out of this.active) {
      out.close();
    }
    this.active.clear();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

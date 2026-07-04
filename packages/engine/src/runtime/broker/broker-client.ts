import { create } from "@bufbuild/protobuf";
import { createClient, type Transport } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { type BrokerFrame, BrokerFrameSchema, BrokerService } from "@lode/protocol/proto";
import { createLogger } from "@lode/logger";
import { BoundedAsyncQueue } from "./bounded-async-queue.js";

const log = createLogger("engine.broker.client");

/** Approximate wire size of a frame (payload + small overhead) — the bound for the send queue. */
const frameBytes = (f: BrokerFrame): number => {
  const k = f.kind;
  if ((k.case === "publish" || k.case === "deliver") && k.value.payload !== undefined) {
    return k.value.payload.length + 64;
  }
  return 64;
};

/**
 * The broker CLIENT — dials a relay (`BrokerServer`) over a Connect gRPC bidi stream
 * (`BrokerService.BrokerStream`) and speaks the broker frame protocol. Daemons and mobile use this
 * to reach the relay; `BrokerSyncProtocol` wraps it as a `SyncTransport` (subscribe per
 * docId, publish updates). Content-blind: payloads are forwarded opaque by the relay.
 */

export type BrokerClientOptions = {
  /** The relay URL — `http://host:port` (h2c plaintext) or `https://host:port` (h2+TLS). */
  readonly url: string;
  /** Called on each `deliver` frame — a routed payload for a subscribed workspace, with the
   *  publisher's routing `fromPeerId` ("" if the publisher declared none). */
  readonly onDeliver: (wsId: string, payload: Uint8Array, fromPeerId: string) => void;
  /** Called on a mid-session stream error (relay reset, HTTP/2 RST). Lets a caller fail fast instead
   *  of waiting out a response timeout. (A *connect* failure still rejects open().) Optional. */
  readonly onError?: (err: Error) => void;
  /** Per-connection send-buffer cap (bytes). When the next frame would push the buffered total over
   *  it, the frame is dropped + warned instead of queued — a wedged-but-OPEN relay (TCP up, nothing
   *  draining) can't then grow the send queue without bound and OOM the daemon. Every broker frame is
   *  either best-effort (publish — the sync tick reconverges) or self-correcting (subscribe/peersReq
   *  — a refetch/timeout recovers), so dropping under sustained congestion is safe AND bounded. Set 0
   *  to force-drop in tests. Default 4 MiB. */
  readonly maxSendBufferedBytes?: number;
};

/** How long `peers()` waits for the relay's roster before rejecting (best-effort, no-auth relay). */
const PEER_QUERY_TIMEOUT_MS = 2000;
/** Default send-buffer cap per connection — generous for normal burst (a Loro update blob is KB–MB),
 *  tight enough that a wedged relay can't leak the daemon to OOM. */
const DEFAULT_MAX_SEND_BUFFERED_BYTES = 4 * 1024 * 1024;

export class BrokerClient {
  private readonly onDeliver: BrokerClientOptions["onDeliver"];
  private readonly onError?: BrokerClientOptions["onError"];
  private readonly maxSendBufferedBytes: number;
  private readonly sessionManager: Http2SessionManager;
  /** The outgoing side of the bidi stream — push to send; Connect iterates it at HTTP/2's pace. */
  private readonly out: BoundedAsyncQueue<BrokerFrame>;
  /** Outstanding `peers()` queries, correlated by wsId (one per channel at a time). */
  private readonly peerQueries = new Map<
    string,
    {
      resolve: (peerIds: string[]) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private closed = false;
  private lastError: Error | null = null;

  constructor(opts: BrokerClientOptions) {
    this.onDeliver = opts.onDeliver;
    this.onError = opts.onError;
    this.maxSendBufferedBytes = opts.maxSendBufferedBytes ?? DEFAULT_MAX_SEND_BUFFERED_BYTES;
    this.sessionManager = new Http2SessionManager(opts.url);
    const transport: Transport = createGrpcTransport({
      baseUrl: opts.url,
      sessionManager: this.sessionManager,
    });
    this.out = new BoundedAsyncQueue<BrokerFrame>(
      this.maxSendBufferedBytes,
      frameBytes,
      (frame, bytes, buffered) => {
        log.warn("broker send buffer over cap; dropping frame", {
          kind: frame.kind.case,
          wsId: frame.kind.value?.wsId,
          frameBytes: bytes,
          buffered,
          max: this.maxSendBufferedBytes,
        });
      },
    );
    // Start the bidi call. Connect connects lazily on first iteration; pump drives the response side.
    const incoming = createClient(BrokerService, transport).brokerStream(this.out);
    void this.pump(incoming);
  }

  /** The last mid-session stream error, or null. */
  get error(): Error | null {
    return this.lastError;
  }

  /** Resolve once the HTTP/2 session is established. Rejects on a connect error or if already closed.
   *  Pushing before open() is fine — frames buffer in the queue until Connect drains. */
  async open(): Promise<void> {
    if (this.closed) {
      throw new Error("BrokerClient closed before open");
    }
    const state = await this.sessionManager.connect();
    if (state === "error") {
      const err = this.sessionManager.error();
      throw err instanceof Error ? err : new Error(`broker client connect failed (state ${state})`);
    }
  }

  /** Subscribe to `wsId`. `peerId` (the dataRoot routing id) opts this peer into directed delivery
   *  + the relay's `peers()` roster; omit it for broadcast-only. */
  subscribe(wsId: string, peerId?: string): void {
    this.send(
      create(BrokerFrameSchema, {
        kind: { case: "subscribe", value: { wsId, peerId: peerId ?? "" } },
      }),
    );
  }

  unsubscribe(wsId: string): void {
    this.send(create(BrokerFrameSchema, { kind: { case: "unsubscribe", value: { wsId } } }));
  }

  /** Publish `payload` to all subscribers of `wsId` minus self (broadcast, the default), or to one
   *  `toPeerId` only (directed). */
  publish(wsId: string, payload: Uint8Array, toPeerId?: string): void {
    this.send(
      create(BrokerFrameSchema, {
        kind: { case: "publish", value: { wsId, payload, toPeerId: toPeerId ?? "" } },
      }),
    );
  }

  /** Ask the relay "which dataRoot peerIds are declared on `wsId`?" Resolves with the roster (the
   *  caller filters out its own peerId). Rejects on timeout or stream close — liveness/fallback is
   *  the caller's job (the relay is best-effort, no-auth). One outstanding query per wsId: a second
   *  call for the same wsId supersedes (rejects) the in-flight one. */
  peers(wsId: string): Promise<string[]> {
    const prior = this.peerQueries.get(wsId);
    if (prior) {
      clearTimeout(prior.timer);
      this.peerQueries.delete(wsId);
      prior.reject(new Error(`broker peers query superseded (wsId ${wsId})`));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.peerQueries.delete(wsId)) {
          reject(new Error(`broker peers query timeout (wsId ${wsId})`));
        }
      }, PEER_QUERY_TIMEOUT_MS);
      this.peerQueries.set(wsId, { resolve, reject, timer });
      this.send(create(BrokerFrameSchema, { kind: { case: "peersReq", value: { wsId } } }));
    });
  }

  /** Reject every outstanding `peers()` query (a closed client or a mid-session stream error). */
  private rejectPeerQueries(err: Error): void {
    for (const q of this.peerQueries.values()) {
      clearTimeout(q.timer);
      q.reject(err);
    }
    this.peerQueries.clear();
  }

  private send(frame: BrokerFrame): void {
    this.out.push(frame);
  }

  /** Drive the response stream: route deliver frames to `onDeliver`, peersResp to the matching
   *  `peers()` query. Surface a stream error (relay reset, RST) via `onError` + reject outstanding
   *  queries. Suppressed on intentional close. */
  private async pump(incoming: AsyncIterable<BrokerFrame>): Promise<void> {
    const surface = (err: Error): void => {
      if (this.closed) {
        return; // close() aborts the session → the stream errors as expected; don't surface.
      }
      // Observable even when no onError consumer is wired (a BrokerClient used directly, e.g. a relay
      // probe). The consuming transport / runner interprets + re-logs at warn for round failures; this
      // debug is the raw stream-end signal (a live relay never closes a bidi response mid-session).
      log.debug("broker stream ended", { err });
      this.lastError = err;
      this.rejectPeerQueries(err);
      this.onError?.(err);
    };
    try {
      for await (const frame of incoming) {
        const k = frame.kind;
        if (k.case === "deliver") {
          this.onDeliver(k.value.wsId, k.value.payload, k.value.fromPeerId);
        } else if (k.case === "peersResp") {
          const { wsId, peerIds } = k.value;
          const q = this.peerQueries.get(wsId);
          if (q) {
            clearTimeout(q.timer);
            this.peerQueries.delete(wsId);
            q.resolve([...peerIds]);
          }
        }
      }
      // A live relay never closes a bidi response mid-session — a clean end means it hung up
      // (restart/close). Surface it so callers fail fast (onError + reject in-flight peers())
      // instead of queueing into a dead stream and timing out at the 2s peers() deadline.
      surface(new Error("broker stream ended by relay"));
    } catch (err) {
      surface(err as Error);
    }
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.rejectPeerQueries(new Error("broker client closed"));
      this.out.close(); // ends the request stream → the relay sees this peer disconnect
      this.sessionManager.abort();
    }
  }
}

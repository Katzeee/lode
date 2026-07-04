import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { WebSocket } from "ws";
import { createLogger } from "@lode/logger";
import { type BrokerFrame, BrokerFrameSchema } from "@lode/protocol/proto";

const log = createLogger("transport.broker.client");

/**
 * The broker WebSocket CLIENT — dials a relay (`BrokerServer`) and speaks the broker frame protocol.
 * Daemons and mobile use this to reach the relay; `BrokerClientSyncTransport` wraps it as a
 * `SyncTransport` (subscribe per docId, publish updates). Content-blind: payloads are forwarded
 * opaque by the relay.
 */

export type BrokerClientOptions = {
  /** The relay WebSocket URL, e.g. `ws://127.0.0.1:4193`. */
  readonly url: string;
  /** Called on each `deliver` frame — a routed payload for a subscribed workspace, with the
   *  publisher's routing `fromPeerId` ("" if the publisher declared none). */
  readonly onDeliver: (wsId: string, payload: Uint8Array, fromPeerId: string) => void;
  /** Called on a mid-session socket error (relay reset, ECONNRESET). Lets a caller fail fast instead
   *  of waiting out a response timeout. (A *connect* failure still rejects open().) Optional. */
  readonly onError?: (err: Error) => void;
};

/** How long `peers()` waits for the relay's roster before rejecting (best-effort, no-auth relay). */
const PEER_QUERY_TIMEOUT_MS = 2000;

export class BrokerClient {
  private readonly sock: WebSocket;
  private readonly onDeliver: BrokerClientOptions["onDeliver"];
  private readonly onError: BrokerClientOptions["onError"];
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
    this.sock = new WebSocket(opts.url);
    // A permanent listener keeps Node from throwing on an unhandled 'error'. A mid-session socket
    // error is surfaced via onError + lastError so callers can fail fast instead of waiting out a
    // response timeout. (open()'s temporary listener still rejects on a *connect* failure.)
    this.sock.on("error", (err: Error) => {
      this.lastError = err;
      this.rejectPeerQueries(err);
      this.onError?.(err);
    });
    this.sock.on("message", (data) => {
      const frame = safeDecode(data);
      if (frame?.kind.case === "deliver") {
        this.onDeliver(
          frame.kind.value.wsId,
          frame.kind.value.payload,
          frame.kind.value.fromPeerId,
        );
      } else if (frame?.kind.case === "peersResp") {
        const { wsId, peerIds } = frame.kind.value;
        const q = this.peerQueries.get(wsId);
        if (q) {
          clearTimeout(q.timer);
          this.peerQueries.delete(wsId);
          q.resolve([...peerIds]);
        }
      }
    });
  }

  /** The last mid-session socket error, or null. */
  get error(): Error | null {
    return this.lastError;
  }

  /** Resolve once the socket is OPEN (ready to send). Rejects on a connect error or if already closed. */
  open(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error("BrokerClient closed before open"));
    }
    if (this.sock.readyState === this.sock.OPEN) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const onOpen = (): void => {
        cleanup();
        resolve();
      };
      const onErr = (err: Error): void => {
        cleanup();
        reject(err);
      };
      const cleanup = (): void => {
        this.sock.off("open", onOpen);
        this.sock.off("error", onErr);
      };
      this.sock.once("open", onOpen);
      this.sock.once("error", onErr);
    });
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
   *  caller filters out its own peerId). Rejects on timeout or socket close — liveness/fallback is the
   *  caller's job (the relay is best-effort, no-auth). One outstanding query per wsId: a second call
   *  for the same wsId supersedes (rejects) the in-flight one. */
  peers(wsId: string): Promise<string[]> {
    // The peersReq/Resp protocol correlates by wsId (no reqId), so at most one query per wsId is
    // meaningful. Supersede an in-flight one eagerly — otherwise its timer would fire later and reject
    // THIS call's promise via the shared map slot (both calls would hang/misresolve).
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

  /** Reject every outstanding `peers()` query (a closed transport or a mid-session socket error). */
  private rejectPeerQueries(err: Error): void {
    for (const q of this.peerQueries.values()) {
      clearTimeout(q.timer);
      q.reject(err);
    }
    this.peerQueries.clear();
  }

  private send(frame: BrokerFrame): void {
    if (this.sock.readyState === this.sock.OPEN) {
      this.sock.send(toBinary(BrokerFrameSchema, frame));
    }
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.rejectPeerQueries(new Error("broker client closed"));
      this.sock.close();
    }
  }
}

function safeDecode(data: unknown): BrokerFrame | undefined {
  try {
    return fromBinary(BrokerFrameSchema, Buffer.from(data as Uint8Array));
  } catch (err) {
    log.debug("dropped malformed broker frame", { err });
    return undefined;
  }
}

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { WebSocket } from "ws";
import { type BrokerFrame, BrokerFrameSchema } from "@lode/protocol/proto";

/**
 * The broker WebSocket CLIENT — dials a relay (`BrokerServer`) and speaks the broker frame protocol.
 * Daemons and mobile use this to reach the relay; `BrokerClientSyncTransport` wraps it as a
 * `SyncTransport` (subscribe per docId, publish updates). Content-blind: payloads are forwarded
 * opaque by the relay.
 */

export type BrokerClientOptions = {
  /** The relay WebSocket URL, e.g. `ws://127.0.0.1:4193`. */
  readonly url: string;
  /** Called on each `deliver` frame (a routed payload for a subscribed workspace). */
  readonly onDeliver: (wsId: string, payload: Uint8Array) => void;
  /** Called on a mid-session socket error (relay reset, ECONNRESET). Lets a caller fail fast instead
   *  of waiting out a response timeout. (A *connect* failure still rejects open().) Optional. */
  readonly onError?: (err: Error) => void;
};

export class BrokerClient {
  private readonly sock: WebSocket;
  private readonly onDeliver: BrokerClientOptions["onDeliver"];
  private readonly onError: BrokerClientOptions["onError"];
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
      this.onError?.(err);
    });
    this.sock.on("message", (data) => {
      const frame = safeDecode(data);
      if (frame?.kind.case === "deliver") {
        this.onDeliver(frame.kind.value.wsId, frame.kind.value.payload);
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

  subscribe(wsId: string): void {
    this.send(create(BrokerFrameSchema, { kind: { case: "subscribe", value: { wsId } } }));
  }

  unsubscribe(wsId: string): void {
    this.send(create(BrokerFrameSchema, { kind: { case: "unsubscribe", value: { wsId } } }));
  }

  publish(wsId: string, payload: Uint8Array): void {
    this.send(create(BrokerFrameSchema, { kind: { case: "publish", value: { wsId, payload } } }));
  }

  private send(frame: BrokerFrame): void {
    if (this.sock.readyState === this.sock.OPEN) {
      this.sock.send(toBinary(BrokerFrameSchema, frame));
    }
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.sock.close();
    }
  }
}

function safeDecode(data: unknown): BrokerFrame | undefined {
  try {
    return fromBinary(BrokerFrameSchema, Buffer.from(data as Uint8Array));
  } catch {
    return undefined;
  }
}

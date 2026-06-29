import { WebSocket } from "ws";
import { decodeFrame, encodeFrame, type BrokerFrame } from "./frame.js";

/**
 * The broker WebSocket CLIENT — dials a relay (`BrokerServer`) and speaks the broker frame protocol.
 * Daemons and mobile use this to reach the relay; T2 wraps it as a `SyncTransport` (subscribe per
 * docId, publish updates). Content-blind: payloads are forwarded opaque by the relay.
 */

export type BrokerClientOptions = {
  /** The relay WebSocket URL, e.g. `ws://127.0.0.1:4193`. */
  readonly url: string;
  /** Called on each `deliver` frame (a routed payload for a subscribed workspace). */
  readonly onDeliver: (wsId: string, payload: Uint8Array) => void;
};

export class BrokerClient {
  private readonly sock: WebSocket;
  private readonly onDeliver: BrokerClientOptions["onDeliver"];
  private closed = false;

  constructor(opts: BrokerClientOptions) {
    this.onDeliver = opts.onDeliver;
    this.sock = new WebSocket(opts.url);
    // Permanent error sink: a mid-session socket error (relay reset, ECONNRESET) must never crash
    // the process — Node throws on an unhandled 'error'. (open()'s temporary listener still rejects
    // on a *connect* failure.) A closed socket is surfaced via the 'close' event, not here.
    this.sock.on("error", () => {
      // no-op
    });
    this.sock.on("message", (data) => {
      const frame = safeDecode(data);
      if (frame?.kind === "deliver") {
        this.onDeliver(frame.wsId, frame.payload);
      }
    });
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
    this.send({ kind: "subscribe", wsId });
  }

  unsubscribe(wsId: string): void {
    this.send({ kind: "unsubscribe", wsId });
  }

  publish(wsId: string, payload: Uint8Array): void {
    this.send({ kind: "publish", wsId, payload });
  }

  private send(frame: BrokerFrame): void {
    if (this.sock.readyState === this.sock.OPEN) {
      this.sock.send(encodeFrame(frame));
    }
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.sock.close();
    }
  }
}

function safeDecode(data: unknown): ReturnType<typeof decodeFrame> | undefined {
  try {
    return decodeFrame(Buffer.from(data as Uint8Array));
  } catch {
    return undefined;
  }
}

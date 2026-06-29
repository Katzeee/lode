import { randomUUID } from "node:crypto";
import { VersionVector } from "loro-crdt";
import type { ShardedBlockStore, SyncDoc, SyncProfile, SyncTransport } from "@lode/engine";
import { BrokerClient } from "./broker-client.js";
import {
  decodeProfile,
  decodeSyncMessage,
  encodeProfile,
  encodeSyncMessage,
} from "./sync-message.js";
import { open, seal, type WireSecurity } from "./wire-security.js";

/**
 * `SyncTransport` over the broker — the T2 adapter (design: request/response over the broker's
 * pub/sub). Each peer runs BOTH halves:
 *   - **Initiator** (the `SyncTransport` methods, driven by the engine's `SyncManager`): publish a
 *     correlated request and await the matching response (by `reqId`).
 *   - **Responder** (every incoming payload): answer profile/updates requests from the local
 *     `ShardedBlockStore`, and import pushed updates.
 *
 * Sender-exclusion in the broker means a peer never receives its own request, so a request always
 * reaches the OTHER subscriber(s); for 2 peers there's exactly one responder. For N>2 the initiator
 * takes the first response (MVP — CRDT transitivity converges everyone from one up-to-date peer).
 */
export class BrokerClientSyncTransport implements SyncTransport {
  private readonly store: ShardedBlockStore;
  private readonly workspaceId: string;
  private readonly responseTimeoutMs: number;
  private readonly brokerClient: BrokerClient;
  private readonly security?: WireSecurity;
  private readonly pending = new Map<
    string,
    {
      resolve: (body: Uint8Array) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(opts: {
    readonly url: string;
    readonly store: ShardedBlockStore;
    readonly workspaceId: string;
    readonly responseTimeoutMs?: number;
    /** Optional transit-key AEAD + actor wire signing (T3). Omit for plaintext (T2 behavior). */
    readonly security?: WireSecurity;
  }) {
    this.store = opts.store;
    this.workspaceId = opts.workspaceId;
    this.responseTimeoutMs = opts.responseTimeoutMs ?? 2000;
    this.security = opts.security;
    this.brokerClient = new BrokerClient({
      url: opts.url,
      onDeliver: (_wsId, payload) => this.handle(payload),
    });
  }

  /** Seal a sync-message payload with the transit key (if security is on); else pass through. */
  private wireEncode(msgBytes: Uint8Array): Uint8Array {
    return this.security ? seal(this.security, msgBytes) : msgBytes;
  }

  /** Connect + subscribe to the workspace. Await before driving sync rounds. */
  async open(): Promise<void> {
    await this.brokerClient.open();
    this.brokerClient.subscribe(this.workspaceId);
  }

  close(): void {
    // Reject in-flight requests (don't leave SyncManager.sync() awaiting a promise that never
    // settles) before tearing down the socket.
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("sync transport closed"));
    }
    this.pending.clear();
    this.brokerClient.close();
  }

  // ── SyncTransport: initiator (driven by SyncManager) ────────────────────────────

  async remoteProfile(): Promise<SyncProfile> {
    const reqId = randomUUID();
    const body = await this.request(reqId, encodeSyncMessage({ kind: "profile-req", reqId }));
    return decodeProfile(body);
  }

  async fetchUpdates(docId: string, from: VersionVector): Promise<Uint8Array> {
    const reqId = randomUUID();
    return this.request(
      reqId,
      encodeSyncMessage({ kind: "updates-req", reqId, docId, body: from.encode() }),
    );
  }

  sendUpdates(docId: string, bytes: Uint8Array): Promise<void> {
    this.brokerClient.publish(
      this.workspaceId,
      this.wireEncode(encodeSyncMessage({ kind: "updates-push", docId, body: bytes })),
    );
    return Promise.resolve();
  }

  // ── responder: answer peers from the local store ────────────────────────────────

  private handle(payload: Uint8Array): void {
    let msg: ReturnType<typeof decodeSyncMessage>;
    try {
      const plain = this.security ? open(this.security, payload) : payload;
      msg = decodeSyncMessage(plain);
    } catch {
      return; // drop malformed/undecryptable — never abort the responder
    }
    switch (msg.kind) {
      case "profile-req":
        this.respondProfile(msg.reqId);
        break;
      case "updates-req":
        this.respondUpdates(msg.reqId, msg.docId, msg.body);
        break;
      case "updates-push":
        this.applyPush(msg.docId, msg.body);
        break;
      case "profile-resp":
        this.resolve(msg.reqId, msg.body);
        break;
      case "updates-resp":
        this.resolve(msg.reqId, msg.body);
        break;
    }
  }

  private respondProfile(reqId: string): void {
    const profile: SyncProfile = this.store
      .syncDocs()
      .map((d) => ({ docId: d.id, version: d.version() }));
    this.brokerClient.publish(
      this.workspaceId,
      this.wireEncode(
        encodeSyncMessage({ kind: "profile-resp", reqId, body: encodeProfile(profile) }),
      ),
    );
  }

  private respondUpdates(reqId: string, docId: string, fromVVBytes: Uint8Array): void {
    const doc = this.syncDoc(docId);
    const body = doc ? doc.exportUpdate(VersionVector.decode(fromVVBytes)) : new Uint8Array(0);
    this.brokerClient.publish(
      this.workspaceId,
      this.wireEncode(encodeSyncMessage({ kind: "updates-resp", reqId, body })),
    );
  }

  private applyPush(docId: string, bytes: Uint8Array): void {
    if (bytes.length === 0) {
      return;
    }
    const doc = this.syncDoc(docId);
    if (doc) {
      doc.importUpdate(bytes);
    }
    // An unknown-shard push with no local doc is dropped — SyncManager materializes shards via the
    // treeDoc exchange before pushing them, so this only happens for genuinely foreign doc ids.
  }

  /** The local SyncDoc for `docId`, if the store already has it. Does NOT materialize shards on
   *  demand — the engine's `SyncManager` owns shard materialization (via the treeDoc exchange), so
   *  the responder answering from existing docs is correct AND avoids creating empty shards for
   *  arbitrary attacker-controlled docIds (which would pollute the profile). */
  private syncDoc(docId: string): SyncDoc | undefined {
    return this.store.syncDocs().find((d) => d.id === docId);
  }

  // ── request/response correlation ────────────────────────────────────────────────

  private request(reqId: string, msgBytes: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(reqId)) {
          reject(new Error(`sync response timeout (reqId ${reqId})`));
        }
      }, this.responseTimeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
      this.brokerClient.publish(this.workspaceId, this.wireEncode(msgBytes));
    });
  }

  private resolve(reqId: string, body: Uint8Array): void {
    const entry = this.pending.get(reqId);
    if (entry) {
      clearTimeout(entry.timer);
      this.pending.delete(reqId);
      entry.resolve(body);
    }
  }
}

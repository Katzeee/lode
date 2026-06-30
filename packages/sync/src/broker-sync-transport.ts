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
 * When `security` is configured, every published payload carries a 1-byte envelope tag so the receiver
 * can demux plaintext vs sealed WITHOUT decoding (the `docId` lives inside the message, which is the
 * sealed plaintext — unreadable until opened). `0x00` = plaintext (the membership doc — a public roster
 * that must be readable before a device holds the transit key); `0x01` = sealed (everything else). When
 * `security` is OFF the transport is raw/untagged (the T2/T4-a plaintext path), byte-identical to before.
 */
const TAG_PLAIN = 0x00;
const TAG_SEALED = 0x01;

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
  private readonly publicDocs?: () => SyncDoc[];
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
    /** Docs that ride the PLAINTEXT envelope AND are served on the push-apply path — the membership
     *  log, a public roster a joining device reads BEFORE it holds the transit key. One option covers
     *  both concerns (they are the same set): the plaintext-exemption set is derived from these ids. */
    readonly publicDocs?: () => SyncDoc[];
  }) {
    this.store = opts.store;
    this.workspaceId = opts.workspaceId;
    this.responseTimeoutMs = opts.responseTimeoutMs ?? 2000;
    this.security = opts.security;
    this.publicDocs = opts.publicDocs;
    this.brokerClient = new BrokerClient({
      url: opts.url,
      onDeliver: (_wsId, payload) => this.handle(payload),
      onError: (err) => this.rejectPending(err),
    });
  }

  /** Envelope a sync-message payload: untagged raw when security is off; else a `[tag][body]` frame
   *  where body is the raw message (plaintext, for `plaintextDocIds` push) or `seal(...)` (sealed). */
  private wireEncode(msgBytes: Uint8Array, plaintext: boolean): Uint8Array {
    if (!this.security) {
      return msgBytes;
    }
    const body = plaintext ? msgBytes : seal(this.security, msgBytes);
    return Buffer.concat([Buffer.from([plaintext ? TAG_PLAIN : TAG_SEALED]), Buffer.from(body)]);
  }

  /** Connect + subscribe to the workspace. Await before driving sync rounds. */
  async open(): Promise<void> {
    await this.brokerClient.open();
    this.brokerClient.subscribe(this.workspaceId);
  }

  close(): void {
    // Reject in-flight requests (don't leave SyncManager.sync() awaiting a promise that never
    // settles) before tearing down the socket.
    this.rejectPending(new Error("sync transport closed"));
    this.brokerClient.close();
  }

  /** Reject every pending request with `err` (a closed transport or a mid-session socket error). */
  private rejectPending(err: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  // ── SyncTransport: initiator (driven by SyncManager) ────────────────────────────

  async remoteProfile(): Promise<SyncProfile> {
    const reqId = randomUUID();
    const body = await this.request(reqId, encodeSyncMessage({ kind: "profileReq", reqId }));
    return decodeProfile(body);
  }

  async fetchUpdates(docId: string, from: VersionVector): Promise<Uint8Array> {
    const reqId = randomUUID();
    return this.request(
      reqId,
      encodeSyncMessage({ kind: "updatesReq", reqId, docId, body: from.encode() }),
    );
  }

  sendUpdates(docId: string, bytes: Uint8Array): Promise<void> {
    const plaintext = this.publicDocs?.().some((d) => d.id === docId) ?? false;
    this.brokerClient.publish(
      this.workspaceId,
      this.wireEncode(encodeSyncMessage({ kind: "updatesPush", docId, body: bytes }), plaintext),
    );
    return Promise.resolve();
  }

  // ── responder: answer peers from the local store ────────────────────────────────

  private handle(payload: Uint8Array): void {
    let msg: ReturnType<typeof decodeSyncMessage>;
    try {
      if (!this.security) {
        msg = decodeSyncMessage(payload);
      } else {
        // Demux by envelope tag: 0x00 plaintext (membership push), 0x01 sealed (everything else).
        const tag = payload[0];
        const body = payload.subarray(1);
        if (tag === TAG_PLAIN) {
          msg = decodeSyncMessage(body);
        } else if (tag === TAG_SEALED) {
          msg = decodeSyncMessage(open(this.security, body));
        } else {
          return; // unknown tag — drop
        }
      }
    } catch {
      return; // drop malformed/undecryptable — never abort the responder
    }
    switch (msg.kind) {
      case "profileReq":
        this.respondProfile(msg.reqId);
        break;
      case "updatesReq":
        this.respondUpdates(msg.reqId, msg.docId, msg.body);
        break;
      case "updatesPush":
        this.applyPush(msg.docId, msg.body);
        break;
      case "profileResp":
        this.resolve(msg.reqId, msg.body);
        break;
      case "updatesResp":
        this.resolve(msg.reqId, msg.body);
        break;
    }
  }

  private respondProfile(reqId: string): void {
    // Profile is STORE-ONLY: extra docs (the membership log) are push-applied, never advertised —
    // otherwise SyncManager would treat the membership docId as a shard and materialize a bogus shard.
    const profile: SyncProfile = this.store
      .syncDocs()
      .map((d) => ({ docId: d.id, version: d.version() }));
    this.brokerClient.publish(
      this.workspaceId,
      this.wireEncode(
        encodeSyncMessage({ kind: "profileResp", reqId, body: encodeProfile(profile) }),
        false,
      ),
    );
  }

  private respondUpdates(reqId: string, docId: string, fromVVBytes: Uint8Array): void {
    const doc = this.lookupDoc(docId);
    const body = doc ? doc.exportUpdate(VersionVector.decode(fromVVBytes)) : new Uint8Array(0);
    this.brokerClient.publish(
      this.workspaceId,
      this.wireEncode(encodeSyncMessage({ kind: "updatesResp", reqId, body }), false),
    );
  }

  private applyPush(docId: string, bytes: Uint8Array): void {
    if (bytes.length === 0) {
      return;
    }
    const doc = this.lookupDoc(docId);
    if (doc) {
      doc.importUpdate(bytes);
    }
    // An unknown-shard push with no local doc is dropped — SyncManager materializes shards via the
    // treeDoc exchange before pushing them, so this only happens for genuinely foreign doc ids.
  }

  /** The local SyncDoc for `docId` across the store AND any extra docs (the membership log), if
   *  present. Does NOT materialize shards on demand — the engine's `SyncManager` owns shard
   *  materialization (via the treeDoc exchange), so answering from existing docs is correct AND avoids
   *  creating empty shards for arbitrary attacker-controlled docIds (which would pollute the profile). */
  private lookupDoc(docId: string): SyncDoc | undefined {
    return this.lookupDocs().find((d) => d.id === docId);
  }

  private lookupDocs(): SyncDoc[] {
    return [...this.store.syncDocs(), ...(this.publicDocs?.() ?? [])];
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
      this.brokerClient.publish(this.workspaceId, this.wireEncode(msgBytes, false));
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

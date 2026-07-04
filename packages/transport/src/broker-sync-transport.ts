import { randomUUID } from "node:crypto";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { VersionVector } from "loro-crdt";
import type {
  ShardedBlockStore,
  SyncDoc,
  SyncProfile,
  SyncTransport,
  WireSecurity,
} from "@lode/engine";
import { decodeProfile, encodeProfile, open, seal } from "@lode/engine";
import { createLogger } from "@lode/logger";
import { type SyncMessage, SyncMessageSchema } from "@lode/protocol/proto";
import { BrokerClient } from "./broker-client.js";

const log = createLogger("transport.broker.sync");

/**
 * When `security` is configured, every published payload carries a 1-byte envelope tag so the receiver
 * can demux plaintext vs sealed WITHOUT decoding (the `docId` lives inside the message, which is the
 * sealed plaintext — unreadable until opened). `0x00` = plaintext (the membership doc — a public roster
 * that must be readable before a device holds the transit key); `0x01` = sealed (everything else). When
 * `security` is OFF the transport is raw/untagged.
 */
const TAG_PLAIN = 0x00;
const TAG_SEALED = 0x01;

/**
 * `SyncTransport` over the broker (design: request/response over the broker's pub/sub). Each peer
 * runs BOTH halves:
 *   - **Initiator** (the `SyncTransport` methods, driven by the engine's `SyncManager`): publish a
 *     correlated request and await the matching response (by `reqId`).
 *   - **Responder** (every incoming payload): answer profile/updates requests from the local
 *     `ShardedBlockStore`, and import pushed updates.
 *
 * Sender-exclusion in the broker means a peer never receives its own request, so a request always
 * reaches the OTHER subscriber(s); for 2 peers there's exactly one responder. For N>2 the initiator
 * takes the first response (CRDT transitivity converges everyone from one up-to-date peer).
 */
export class BrokerClientSyncTransport implements SyncTransport {
  private readonly store: ShardedBlockStore;
  private readonly workspaceId: string;
  private readonly responseTimeoutMs: number;
  private readonly brokerClient: BrokerClient;
  private readonly security?: WireSecurity;
  private readonly publicDocs?: () => SyncDoc[];
  /** This replica's per-dataRoot routing peerId (declared at subscribe so the peer is a directed
   *  target + appears in `peers()`). The engine's numeric site id, stringified for the broker. */
  private readonly peerId?: string;
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
    /** Optional transit-key AEAD + actor wire signing. Omit for plaintext. */
    readonly security?: WireSecurity;
    /** Docs that ride the PLAINTEXT envelope AND are served on the push-apply path — the membership
     *  log, a public roster a joining device reads BEFORE it holds the transit key. One option covers
     *  both concerns (they are the same set): the plaintext-exemption set is derived from these ids. */
    readonly publicDocs?: () => SyncDoc[];
    /** This replica's routing peerId (the engine's numeric site id as a string). Declared at subscribe
     *  so the peer is reachable by a directed request + listed in `peers()`. Omit for broadcast-only. */
    readonly peerId?: string;
  }) {
    this.store = opts.store;
    this.workspaceId = opts.workspaceId;
    this.responseTimeoutMs = opts.responseTimeoutMs ?? 2000;
    this.security = opts.security;
    this.publicDocs = opts.publicDocs;
    this.peerId = opts.peerId;
    this.brokerClient = new BrokerClient({
      url: opts.url,
      onDeliver: (_wsId, payload, fromPeerId) => this.handle(payload, fromPeerId),
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

  /** Connect + subscribe to the workspace (declaring this replica's peerId so it's a directed target
   *  + discoverable via `peers()`). Await before driving sync rounds. */
  async open(): Promise<void> {
    await this.brokerClient.open();
    this.brokerClient.subscribe(this.workspaceId, this.peerId);
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
    const body = await this.request(
      reqId,
      encodeMessage({ kind: { case: "profileReq", value: { reqId } } }),
    );
    return decodeProfile(body);
  }

  async fetchUpdates(docId: string, from: VersionVector): Promise<Uint8Array> {
    const reqId = randomUUID();
    return this.request(
      reqId,
      encodeMessage({
        kind: { case: "updatesReq", value: { reqId, docId, body: from.encode() } },
      }),
      undefined,
      this.isPublicDoc(docId),
    );
  }

  /** Directed `fetchUpdates` (§3c): same `updatesReq/Resp` + `reqId` correlation, but the request
   *  publish carries `toPeerId` so the relay routes it to ONE peer (cold-start fetch — a joiner asks a
   *  specific member for the membership doc). The request is PLAINTEXT for a public doc (the membership
   *  roster): a joiner fetches it BEFORE it holds the transit key, so it cannot seal the request — the
   *  bootstrap chicken-and-egg. The response is broadcast (sender-exclusion delivers it back here) and
   *  also plaintext for a public doc. Not on the `SyncTransport` interface — the engine's SyncManager
   *  broadcasts; only the daemon's join path directs. */
  async directedFetchUpdates(
    docId: string,
    from: VersionVector,
    toPeerId: string,
  ): Promise<Uint8Array> {
    const reqId = randomUUID();
    return this.request(
      reqId,
      encodeMessage({
        kind: { case: "updatesReq", value: { reqId, docId, body: from.encode() } },
      }),
      toPeerId,
      this.isPublicDoc(docId),
    );
  }

  /** The routing peerIds declared on this workspace's channel (§3c discovery: "who's on channel W?"),
   *  INCLUDING this replica's own — the caller filters self. Empty until peers subscribe with a peerId. */
  peers(): Promise<string[]> {
    return this.brokerClient.peers(this.workspaceId);
  }

  /** Whether `docId` is a public doc (rides the plaintext envelope). The membership roster is public so
   *  a joiner can fetch + read it BEFORE it holds the transit key. */
  private isPublicDoc(docId: string): boolean {
    return this.publicDocs?.().some((d) => d.id === docId) ?? false;
  }

  sendUpdates(docId: string, bytes: Uint8Array): Promise<void> {
    this.brokerClient.publish(
      this.workspaceId,
      this.wireEncode(
        encodeMessage({ kind: { case: "updatesPush", value: { docId, body: bytes } } }),
        this.isPublicDoc(docId),
      ),
    );
    return Promise.resolve();
  }

  // ── responder: answer peers from the local store ────────────────────────────────

  private handle(payload: Uint8Array, fromPeerId: string): void {
    let msg: SyncMessage;
    try {
      if (!this.security) {
        msg = fromBinary(SyncMessageSchema, payload);
      } else {
        // Demux by envelope tag: 0x00 plaintext (membership push), 0x01 sealed (everything else).
        const tag = payload[0];
        const body = payload.subarray(1);
        if (tag === TAG_PLAIN) {
          msg = fromBinary(SyncMessageSchema, body);
        } else if (tag === TAG_SEALED) {
          msg = fromBinary(SyncMessageSchema, open(this.security, body));
        } else {
          log.debug("dropped frame with unknown envelope tag", { peerId: fromPeerId });
          return; // unknown tag — drop
        }
      }
    } catch (err) {
      // drop malformed/undecryptable — never abort the responder. Debug because a bad/tampered frame
      // is protocol noise; turn up transport=debug when diagnosing "why won't a peer's updates apply".
      log.debug("dropped undecryptable sync frame", { peerId: fromPeerId, err });
      return;
    }
    const k = msg.kind;
    switch (k.case) {
      case "profileReq":
        this.respondProfile(k.value.reqId, fromPeerId);
        break;
      case "updatesReq":
        this.respondUpdates(k.value.reqId, k.value.docId, k.value.body, fromPeerId);
        break;
      case "updatesPush":
        this.applyPush(k.value.docId, k.value.body);
        break;
      case "profileResp":
        this.resolve(k.value.reqId, k.value.body);
        break;
      case "updatesResp":
        this.resolve(k.value.reqId, k.value.body);
        break;
      case undefined:
        // Empty/garbage payload — drop.
        log.debug("dropped sync frame with empty/unknown kind", { peerId: fromPeerId });
        break;
    }
  }

  private respondProfile(reqId: string, fromPeerId: string): void {
    // Profile is STORE-ONLY: extra docs (the membership log) are push-applied, never advertised —
    // otherwise SyncManager would treat the membership docId as a shard and materialize a bogus shard.
    const profile: SyncProfile = this.store
      .syncDocs()
      .map((d) => ({ docId: d.id, version: d.version() }));
    this.replyTo(
      fromPeerId,
      encodeMessage({
        kind: { case: "profileResp", value: { reqId, body: encodeProfile(profile) } },
      }),
      false,
    );
  }

  private respondUpdates(
    reqId: string,
    docId: string,
    fromVVBytes: Uint8Array,
    fromPeerId: string,
  ): void {
    const doc = this.lookupDoc(docId);
    const body = doc ? doc.exportUpdate(VersionVector.decode(fromVVBytes)) : new Uint8Array(0);
    // A public doc (the membership roster) is answered on the plaintext envelope so a joiner can
    // fetch it via `fetchUpdates("membership")` BEFORE it holds the transit key. Mirrors sendUpdates.
    this.replyTo(
      fromPeerId,
      encodeMessage({ kind: { case: "updatesResp", value: { reqId, body } } }),
      this.isPublicDoc(docId),
    );
  }

  /** Publish a response directed at the asker when they declared a peerId — private (the sealed
   *  response reaches only the initiator, not every subscriber) and avoids fanning it across the
   *  channel for N>2. Falls back to broadcast when the asker declared no peerId. */
  private replyTo(fromPeerId: string, msgBytes: Uint8Array, plaintext: boolean): void {
    this.brokerClient.publish(
      this.workspaceId,
      this.wireEncode(msgBytes, plaintext),
      fromPeerId || undefined,
    );
  }

  private applyPush(docId: string, bytes: Uint8Array): void {
    if (bytes.length === 0) {
      return;
    }
    const doc = this.lookupDoc(docId);
    if (doc) {
      doc.importUpdate(bytes);
    } else {
      // An unknown-shard push with no local doc — SyncManager materializes shards via the treeDoc
      // exchange before pushing them, so this only happens for genuinely foreign (often attacker
      // -controlled) doc ids. Debug: protocol noise, not a normal cold-start path.
      log.debug("dropped push for unknown doc", { docId });
    }
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

  private request(
    reqId: string,
    msgBytes: Uint8Array,
    toPeerId?: string,
    plaintext = false,
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(reqId)) {
          reject(new Error(`sync response timeout (reqId ${reqId})`));
        }
      }, this.responseTimeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
      this.brokerClient.publish(this.workspaceId, this.wireEncode(msgBytes, plaintext), toPeerId);
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

/** Tiny inline encoder so each call site doesn't repeat `toBinary(SyncMessageSchema, create(...))`. */
function encodeMessage(init: Parameters<typeof create<typeof SyncMessageSchema>>[1]): Uint8Array {
  return toBinary(SyncMessageSchema, create(SyncMessageSchema, init));
}

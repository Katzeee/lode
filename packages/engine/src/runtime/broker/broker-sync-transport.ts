/* eslint-disable max-lines -- one cohesive SyncTransport-over-broker impl: the initiator
   (request/response correlation by reqId) + responder (profile/updates/push) + the per-doc recv
   drainer share the protocol's private state (store/security/pending/docQueues); splitting would
   force an awkward seam through them. */
import { randomUUID } from "node:crypto";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { VersionVector } from "loro-crdt";
import { createLogger } from "@lode/logger";
import { type SyncMessage, SyncMessageSchema } from "@lode/protocol/proto";
import { BrokerClient } from "./broker-client.js";
import { BoundedAsyncQueue } from "./bounded-async-queue.js";
import { decodeProfile, encodeProfile } from "../sync-message.js";
import { open, seal } from "../membership/wire-security.js";
import type { ShardedBlockStore, SyncDoc } from "../../core/sharded-store.js";
import type { SyncProfile, SyncTransport } from "../sync.js";
import type { WireSecurity } from "../membership/wire-security.js";

const log = createLogger("engine.broker.sync");

/**
 * When `security` is configured, every published payload carries a 1-byte envelope tag so the receiver
 * can demux plaintext vs sealed WITHOUT decoding (the `docId` lives inside the message, which is the
 * sealed plaintext — unreadable until opened). `0x00` = plaintext (the membership doc — a public roster
 * that must be readable before a peer holds the transit key); `0x01` = sealed (everything else). When
 * `security` is OFF the transport is raw/untagged.
 */
const TAG_PLAIN = 0x00;
const TAG_SEALED = 0x01;

/**
 * A per-doc recv task — an export-on-request (`respond`) or an import-on-push (`apply`). Both touch
 * the same LoroDoc, so they serialize per-doc (Loro's WASM is single-threaded anyway); the per-doc
 * ISOLATION is the win — a slow op on doc A only blocks doc A, not doc B nor the cheap responder path
 * (profile advertisement, response resolve, which stay inline in `handle`). Dispatched off the recv
 * pump so a slow WASM op (a large import/export) doesn't head-of-line block other frames. any-sync's
 * `multiqueue` shape.
 */
type DocTask =
  | {
      readonly kind: "respond";
      readonly reqId: string;
      readonly fromVVBytes: Uint8Array;
      readonly fromPeerId: string;
    }
  | { readonly kind: "apply"; readonly bytes: Uint8Array };

/** Per-doc recv queue cap (bytes). A slow doc's queued tasks can't grow this without bound — the
 *  tick reconverges dropped pushes; a dropped respond times out + retries on the asker. */
const DEFAULT_MAX_RECV_PER_DOC_BYTES = 4 * 1024 * 1024;

/** Approximate size of a per-doc recv task (its payload + small overhead) — the bound for the queue. */
const taskBytes = (t: DocTask): number =>
  (t.kind === "apply" ? t.bytes.length : t.fromVVBytes.length) + 64;

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
export class BrokerSyncProtocol implements SyncTransport {
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
  /** Per-doc recv task queues — one drainer per doc, so a slow Loro import/export on one doc doesn't
   *  head-of-line block the recv pump (and other docs). Bounded (drop-on-overflow). */
  private readonly docQueues = new Map<string, BoundedAsyncQueue<DocTask>>();
  private readonly maxRecvPerDocBytes: number;

  constructor(opts: {
    readonly url: string;
    readonly store: ShardedBlockStore;
    readonly workspaceId: string;
    readonly responseTimeoutMs?: number;
    /** Optional transit-key AEAD + actor wire signing. Omit for plaintext. */
    readonly security?: WireSecurity;
    /** Docs that ride the PLAINTEXT envelope AND are served on the push-apply path — the membership
     *  log, a public roster a joining peer reads BEFORE it holds the transit key. One option covers
     *  both concerns (they are the same set): the plaintext-exemption set is derived from these ids. */
    readonly publicDocs?: () => SyncDoc[];
    /** This replica's routing peerId (the engine's numeric site id as a string). Declared at subscribe
     *  so the peer is reachable by a directed request + listed in `peers()`. Omit for broadcast-only. */
    readonly peerId?: string;
    /** Per-doc recv queue cap (bytes); a slow doc's inbound tasks can't grow it without bound.
     *  Default 4 MiB. */
    readonly maxRecvPerDocBytes?: number;
  }) {
    this.store = opts.store;
    this.workspaceId = opts.workspaceId;
    this.responseTimeoutMs = opts.responseTimeoutMs ?? 2000;
    this.security = opts.security;
    this.publicDocs = opts.publicDocs;
    this.peerId = opts.peerId;
    this.maxRecvPerDocBytes = opts.maxRecvPerDocBytes ?? DEFAULT_MAX_RECV_PER_DOC_BYTES;
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
    // Close every per-doc recv queue → its drainer's `for await` completes (queued-but-unrun tasks
    // are dropped; the tick reconverges). Before the socket so no new tasks arrive mid-teardown.
    for (const q of this.docQueues.values()) {
      q.close();
    }
    this.docQueues.clear();
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
        this.enqueueDoc(k.value.docId, {
          kind: "respond",
          reqId: k.value.reqId,
          fromVVBytes: k.value.body,
          fromPeerId,
        });
        break;
      case "updatesPush":
        this.enqueueDoc(k.value.docId, { kind: "apply", bytes: k.value.body });
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

  /** Dispatch a per-doc recv task (export-on-request / import-on-push) onto that doc's queue. The
   *  drainer runs the slow WASM op OFF the recv pump, so it doesn't head-of-line block other docs or
   *  the cheap responder path (profile advertise / response resolve stay inline in `handle`). One
   *  drainer per doc → slow ops on doc A only block doc A. */
  private enqueueDoc(docId: string, task: DocTask): void {
    let q = this.docQueues.get(docId);
    if (q === undefined) {
      q = new BoundedAsyncQueue<DocTask>(
        this.maxRecvPerDocBytes,
        taskBytes,
        (item, bytes, buffered) => {
          log.warn("broker recv per-doc queue over cap; dropping task", {
            docId,
            task: item.kind,
            taskBytes: bytes,
            buffered,
            max: this.maxRecvPerDocBytes,
          });
        },
      );
      this.docQueues.set(docId, q);
      void this.drainDoc(docId, q);
    }
    q.push(task);
  }

  /** One drainer per doc — runs its tasks serially (Loro ops on a doc must serialize anyway), off the
   *  recv pump. Per-doc isolation: a slow op here blocks only THIS doc's queue. Ends when the queue
   *  closes (transport close — queued-but-unrun tasks are dropped; the tick reconverges). */
  private async drainDoc(docId: string, q: BoundedAsyncQueue<DocTask>): Promise<void> {
    for await (const task of q) {
      try {
        if (task.kind === "respond") {
          this.respondUpdates(task.reqId, docId, task.fromVVBytes, task.fromPeerId);
        } else {
          this.applyPush(docId, task.bytes);
        }
      } catch (err) {
        // A throwing WASM op (corrupt bytes, a loro-crdt bug) must NOT kill this drainer — a dead
        // drainer orphans its queue (enqueueDoc keeps pushing to it) → unbounded leak + that doc
        // stalls forever. Log + continue; a failed respond times out on the asker, a failed apply is
        // reconverged by the tick.
        log.warn("per-doc recv task failed; continuing drainer", { docId, kind: task.kind, err });
      }
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

/* eslint-disable max-lines -- initiator (reqId correlation), responder, and per-doc recv drainer
   share the protocol's private state (store/security/pending/docQueues). */
import { randomUUID } from "node:crypto";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { createLogger } from "@lode/logger";
import { type SyncMessage, SyncMessageSchema } from "@lode/protocol/proto";
import { BrokerClient } from "../../broker/broker-client.js";
import { BoundedAsyncQueue } from "../../broker/bounded-async-queue.js";
import { decodeProfile, encodeProfile } from "../sync-message.js";
import { open, seal } from "../../membership/wire-security.js";
import type { SyncBytes, SyncableDoc } from "../../../core/store/syncable.js";
import type { WorkspaceDocSet } from "../../../core/store/doc-set.js";
import type {
  ManagedSyncTransport,
  SyncProfile,
  SyncTransportFactory,
  SyncTransportInput,
} from "../transport.js";
import type { WireSecurity } from "../../membership/wire-security.js";

const log = createLogger("engine.broker.sync");

/**
 * When `security` is configured, every published payload carries a 1-byte envelope tag so the receiver
 * can demux plaintext vs sealed WITHOUT decoding (the `subDocId` lives inside the message, which is the
 * sealed plaintext — unreadable until opened). `0x00` = plaintext; `0x01` = sealed. When `security` is
 * OFF the transport is raw/untagged.
 *
 * The envelope is the broker's wire vocabulary — `WireEnvelope`, not the product's `SecurityClass`. The
 * product declares a doc's `securityClass` (`"public"` | `"sealed"`) on `DocSetEntry`; `envelopeFor()`
 * translates that to a `WireEnvelope` at the seam, so the framing code below reads/writes only
 * `WireEnvelope` and never the product term.
 */
const TAG_PLAIN = 0x00;
const TAG_SEALED = 0x01;

/** How a frame rides the wire — the broker's own vocabulary. Distinct from the product `SecurityClass`,
 *  which `envelopeFor` maps to this at the seam (a wire concept can't live on the core `DocSetEntry`). */
type WireEnvelope = "plaintext" | "sealed";

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
      readonly fromBytes: Uint8Array;
      readonly fromPeerId: string;
    }
  | { readonly kind: "apply"; readonly bytes: Uint8Array };

/** Per-doc recv queue cap (bytes). A slow doc's queued tasks can't grow this without bound — the
 *  tick reconverges dropped pushes; a dropped respond times out + retries on the asker. */
const DEFAULT_MAX_RECV_PER_DOC_BYTES = 4 * 1024 * 1024;

/** Approximate size of a per-doc recv task (its payload + small overhead) — the bound for the queue. */
const taskBytes = (t: DocTask): number =>
  (t.kind === "apply" ? t.bytes.length : t.fromBytes.length) + 64;

/**
 * `SyncTransport` over the broker (design: request/response over the broker's pub/sub). Each peer
 * runs BOTH halves:
 *   - **Initiator** (the `SyncTransport` methods, driven by the engine's `SyncExchange`): publish a
 *     correlated request and await the matching response (by `reqId`).
 *   - **Responder** (every incoming payload): answer profile/updates requests from the local
 *     composite, and import pushed updates.
 *
 * Sender-exclusion in the broker means a peer never receives its own request, so a request always
 * reaches the OTHER subscriber(s); for 2 peers there's exactly one responder. For N>2 the initiator
 * takes the first response (CRDT transitivity converges everyone from one up-to-date peer).
 */
export class BrokerSyncProtocol implements ManagedSyncTransport {
  private readonly docSet: WorkspaceDocSet;
  private readonly workspaceId: string;
  private readonly responseTimeoutMs: number;
  private readonly brokerClient: BrokerClient;
  private readonly security?: WireSecurity;
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
    /** The workspace's unified doc set — the broker reads doc visibility (sealed/public) and the
     *  doc lookup from it. Replaces the old (composite + publicDocs-thunk) pair: visibility is the
     *  doc's `securityClass`, not an array scan. */
    readonly docSet: WorkspaceDocSet;
    readonly workspaceId: string;
    readonly responseTimeoutMs?: number;
    /** Optional transit-key AEAD + actor wire signing. Omit for plaintext. */
    readonly security?: WireSecurity;
    /** This replica's routing peerId (the engine's numeric site id as a string). Declared at subscribe
     *  so the peer is reachable by a directed request + listed in `peers()`. Omit for broadcast-only. */
    readonly peerId?: string;
    /** Per-doc recv queue cap (bytes); a slow doc's inbound tasks can't grow it without bound.
     *  Default 4 MiB. */
    readonly maxRecvPerDocBytes?: number;
  }) {
    this.docSet = opts.docSet;
    this.workspaceId = opts.workspaceId;
    this.responseTimeoutMs = opts.responseTimeoutMs ?? 2000;
    this.security = opts.security;
    this.peerId = opts.peerId;
    this.maxRecvPerDocBytes = opts.maxRecvPerDocBytes ?? DEFAULT_MAX_RECV_PER_DOC_BYTES;
    this.brokerClient = new BrokerClient({
      url: opts.url,
      onDeliver: (_wsId, payload, fromPeerId) =>
        void this.handle(payload, fromPeerId).catch((err) =>
          log.warn("recv handle failed", { err }),
        ),
      onError: (err) => this.rejectPending(err),
    });
  }

  /** Envelope a sync-message payload: untagged raw when security is off; else a `[tag][body]` frame
   *  where the body is the raw message (plaintext) or `seal(...)` (sealed). */
  private wireEncode(msgBytes: Uint8Array, env: WireEnvelope): Uint8Array {
    if (!this.security) {
      return msgBytes;
    }
    const body = env === "plaintext" ? msgBytes : seal(this.security, msgBytes);
    const tag = env === "plaintext" ? TAG_PLAIN : TAG_SEALED;
    return Buffer.concat([Buffer.from([tag]), Buffer.from(body)]);
  }

  /** Connect + subscribe to the workspace (declaring this replica's peerId so it's a directed target
   *  + discoverable via `peers()`). Await before driving sync rounds. */
  async open(): Promise<void> {
    await this.brokerClient.open();
    this.brokerClient.subscribe(this.workspaceId, this.peerId);
  }

  close(): void {
    // Reject in-flight requests (don't leave SyncExchange.sync() awaiting a promise that never
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

  // ── SyncTransport: initiator (driven by SyncExchange) ────────────────────────────

  async remoteProfile(): Promise<SyncProfile> {
    const reqId = randomUUID();
    const body = await this.request(
      reqId,
      encodeMessage({ kind: { case: "profileReq", value: { reqId } } }),
    );
    return decodeProfile(body);
  }

  async fetchUpdates(subDocId: string, from: SyncBytes): Promise<Uint8Array> {
    const reqId = randomUUID();
    return this.request(
      reqId,
      encodeMessage({
        kind: { case: "updatesReq", value: { reqId, subDocId, body: from } },
      }),
      undefined,
      this.envelopeFor(subDocId),
    );
  }

  /** Directed `fetchUpdates` (§3c): same `updatesReq/Resp` + `reqId` correlation, but the request
   *  publish carries `toPeerId` so the relay routes it to ONE peer (cold-start fetch — a joiner asks a
   *  specific member for the membership doc). The request is PLAINTEXT for a public doc (the membership
   *  roster): a joiner fetches it BEFORE it holds the transit key, so it cannot seal the request — the
   *  bootstrap chicken-and-egg. The response is broadcast (sender-exclusion delivers it back here) and
   *  also plaintext for a public doc. Part of the `SyncTransport` seam — `SyncExchange` broadcasts
   *  (`fetchUpdates`), the engine's join path directs (here, via the registry's directed membership
   *  fetch). */
  async directedFetchUpdates(
    subDocId: string,
    from: SyncBytes,
    toPeerId: string,
  ): Promise<Uint8Array> {
    const reqId = randomUUID();
    return this.request(
      reqId,
      encodeMessage({
        kind: { case: "updatesReq", value: { reqId, subDocId, body: from } },
      }),
      toPeerId,
      this.envelopeFor(subDocId),
    );
  }

  /** The routing peerIds declared on this workspace's channel (§3c discovery: "who's on channel W?"),
   *  INCLUDING this replica's own — the caller filters self. Empty until peers subscribe with a peerId. */
  peers(): Promise<string[]> {
    return this.brokerClient.peers(this.workspaceId);
  }

  /** The wire envelope for `subDocId` — the seam where the product's `securityClass` becomes the
   *  broker's `WireEnvelope`. A public doc (the membership roster) rides plaintext so a joiner can
   *  fetch + read it BEFORE it holds the transit key; everything else is sealed. Unknown docs default
   *  sealed (a sealed reply to an unknown-doc request matches today's behavior). */
  private envelopeFor(subDocId: string): WireEnvelope {
    return this.docSet.entry(subDocId)?.securityClass === "public" ? "plaintext" : "sealed";
  }

  sendUpdates(subDocId: string, bytes: Uint8Array): Promise<void> {
    this.brokerClient.publish(
      this.workspaceId,
      this.wireEncode(
        encodeMessage({ kind: { case: "updatesPush", value: { subDocId, body: bytes } } }),
        this.envelopeFor(subDocId),
      ),
    );
    return Promise.resolve();
  }

  // ── responder: answer peers from the local store ────────────────────────────────

  private async handle(payload: Uint8Array, fromPeerId: string): Promise<void> {
    let msg: SyncMessage;
    try {
      if (!this.security) {
        msg = fromBinary(SyncMessageSchema, payload);
      } else {
        // Demux by envelope tag — INHERENT wire framing, not a doc-semantic branch: the receiver must
        // pick plaintext vs sealed BEFORE decoding (the subDocId lives in the sealed plaintext, which
        // is unreadable until opened). 0x00 plaintext, 0x01 sealed.
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
        await this.respondProfile(k.value.reqId, fromPeerId);
        break;
      case "updatesReq":
        this.enqueueDoc(k.value.subDocId, {
          kind: "respond",
          reqId: k.value.reqId,
          fromBytes: k.value.body,
          fromPeerId,
        });
        break;
      case "updatesPush":
        this.enqueueDoc(k.value.subDocId, { kind: "apply", bytes: k.value.body });
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

  private async respondProfile(reqId: string, fromPeerId: string): Promise<void> {
    // Profile is COMPOSITE-ONLY (the outliner's docs): the membership doc rides push-gossip, not
    // req/resp, so it is deliberately excluded from the profile and can never leak here. The docSet's
    // composite is the outliner; meta docs (membership) are NOT in it. Sequential version reads so two
    // parallel profile builds don't double-fault the same shard.
    const docs = this.docSet.composite().docs();
    const profile: SyncProfile = [];
    for (const d of docs) {
      profile.push({ subDocId: d.id, version: await d.version() });
    }
    this.replyTo(
      fromPeerId,
      encodeMessage({
        kind: { case: "profileResp", value: { reqId, body: encodeProfile(profile) } },
      }),
      "sealed", // the profile is composite-only (sealed content) — always sealed
    );
  }

  private async respondUpdates(
    reqId: string,
    subDocId: string,
    fromBytes: Uint8Array,
    fromPeerId: string,
  ): Promise<void> {
    const doc = this.lookupDoc(subDocId);
    const body = doc ? await doc.exportUpdate(fromBytes) : new Uint8Array(0);
    // Answer on the doc's wire envelope — a public doc (the membership roster) replies plaintext so a
    // joiner can fetch it BEFORE it holds the transit key. Mirrors sendUpdates.
    this.replyTo(
      fromPeerId,
      encodeMessage({ kind: { case: "updatesResp", value: { reqId, body } } }),
      this.envelopeFor(subDocId),
    );
  }

  /** Publish a response directed at the asker when they declared a peerId — private (the sealed
   *  response reaches only the initiator, not every subscriber) and avoids fanning it across the
   *  channel for N>2. Falls back to broadcast when the asker declared no peerId. */
  private replyTo(fromPeerId: string, msgBytes: Uint8Array, env: WireEnvelope): void {
    this.brokerClient.publish(
      this.workspaceId,
      this.wireEncode(msgBytes, env),
      fromPeerId || undefined,
    );
  }

  private async applyPush(subDocId: string, bytes: Uint8Array): Promise<void> {
    if (bytes.length === 0) {
      return;
    }
    const doc = this.lookupDoc(subDocId);
    if (doc) {
      await doc.importUpdate(bytes);
    } else {
      // An unknown-shard push with no local doc — the composite materializes shards via `docs()`
      // (treeDoc ownership reveals them), so this only happens for genuinely foreign (often attacker
      // -controlled) doc ids. Debug: protocol noise, not a normal cold-start path.
      log.debug("dropped push for unknown doc", { subDocId });
    }
  }

  /** Dispatch a per-doc recv task (export-on-request / import-on-push) onto that doc's queue. The
   *  drainer runs the slow WASM op OFF the recv pump, so it doesn't head-of-line block other docs or
   *  the cheap responder path (profile advertise / response resolve stay inline in `handle`). One
   *  drainer per doc → slow ops on doc A only block doc A. */
  private enqueueDoc(subDocId: string, task: DocTask): void {
    let q = this.docQueues.get(subDocId);
    if (q === undefined) {
      q = new BoundedAsyncQueue<DocTask>(
        this.maxRecvPerDocBytes,
        taskBytes,
        (item, bytes, buffered) => {
          log.warn("broker recv per-doc queue over cap; dropping task", {
            subDocId,
            task: item.kind,
            taskBytes: bytes,
            buffered,
            max: this.maxRecvPerDocBytes,
          });
        },
      );
      this.docQueues.set(subDocId, q);
      void this.drainDoc(subDocId, q);
    }
    q.push(task);
  }

  /** One drainer per doc — runs its tasks serially (Loro ops on a doc must serialize anyway), off the
   *  recv pump. Per-doc isolation: a slow op here blocks only THIS doc's queue. Ends when the queue
   *  closes (transport close — queued-but-unrun tasks are dropped; the tick reconverges). */
  private async drainDoc(subDocId: string, q: BoundedAsyncQueue<DocTask>): Promise<void> {
    for await (const task of q) {
      try {
        await (task.kind === "respond"
          ? this.respondUpdates(task.reqId, subDocId, task.fromBytes, task.fromPeerId)
          : this.applyPush(subDocId, task.bytes));
      } catch (err) {
        // A throwing WASM op (corrupt bytes, a loro-crdt bug) must NOT kill this drainer — a dead
        // drainer orphans its queue (enqueueDoc keeps pushing to it) → unbounded leak + that doc
        // stalls forever. Log + continue; a failed respond times out on the asker, a failed apply is
        // reconverged by the tick.
        log.warn("per-doc recv task failed; continuing drainer", {
          subDocId,
          kind: task.kind,
          err,
        });
      }
    }
  }

  /** The local `SyncableDoc` for `subDocId` from the docSet, if present. Does NOT materialize shards
   *  on demand — the docSet's composite owns shard materialization (via treeDoc ownership), so
   *  answering from existing docs is correct AND avoids creating empty shards for arbitrary
   *  attacker-controlled docIds (which would pollute the profile). */
  private lookupDoc(subDocId: string): SyncableDoc | undefined {
    return this.lookupDocs().find((d) => d.id === subDocId);
  }

  private lookupDocs(): SyncableDoc[] {
    return this.docSet.docs();
  }

  // ── request/response correlation ────────────────────────────────────────────────

  private request(
    reqId: string,
    msgBytes: Uint8Array,
    toPeerId?: string,
    env: WireEnvelope = "sealed",
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(reqId)) {
          reject(new Error(`sync response timeout (reqId ${reqId})`));
        }
      }, this.responseTimeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
      this.brokerClient.publish(this.workspaceId, this.wireEncode(msgBytes, env), toPeerId);
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

export class BrokerSyncTransportFactory implements SyncTransportFactory {
  create(input: SyncTransportInput): ManagedSyncTransport {
    return new BrokerSyncProtocol({
      url: input.url,
      docSet: input.documents,
      workspaceId: input.workspaceId,
      security: input.security,
      peerId: input.peerId,
    });
  }
}

/** Tiny inline encoder so each call site doesn't repeat `toBinary(SyncMessageSchema, create(...))`. */
function encodeMessage(init: Parameters<typeof create<typeof SyncMessageSchema>>[1]): Uint8Array {
  return toBinary(SyncMessageSchema, create(SyncMessageSchema, init));
}

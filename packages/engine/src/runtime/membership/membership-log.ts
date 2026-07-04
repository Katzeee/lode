import { encodeFrontiers, LoroDoc, type LoroList } from "loro-crdt";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { createLogger } from "@lode/logger";
import type { MembershipPersistence } from "./membership-persistence.js";
import { bodyBytes, deriveMembershipState } from "./membership-replay.js";
import {
  aeadEncrypt,
  actorEncryptionPrivate,
  actorEncryptionPublic,
  actorIdFromPublicKey,
  signWithActor,
  unwrapKey,
  wrapKey,
  type ActorKeypair,
} from "../../utils/crypto/index.js";
import type { SyncDoc } from "../../core/sharded-store.js";
import {
  AddRecordSchema,
  MemberWrapSchema,
  MembershipRecordSchema,
  RootRecordSchema,
  RotateRecordSchema,
  TransferRecordSchema,
  type MembershipRecord,
} from "@lode/protocol/proto";

const log = createLogger("engine.membership");

/**
 * The membership log — the in-process sync core's membership half (design sync-identity-persistence
 * §2). NOT an ACL: lode has no authoritative server, so this is a replicated, signed, append-only log
 * of who is in a workspace, who owns it, and each member's transit key. Two roles only: owner (the
 * single governance authority) + member(rw). The owner alone signs governance records; members are
 * full rw.
 *
 * Records are protobuf (MembershipRecord) bytes in a LoroList, so the log is itself a Loro doc that
 * syncs like any other. A record is
 * SKIPPED at replay (not fatal) if its signature fails, its signer is unknown, its signer isn't the
 * current owner, or (rotate) its epoch isn't strictly ahead of the current. Deterministic given the
 * merged list → every replica converges. Owner-only governance means there is no multi-admin
 * concurrent conflict to resolve.
 *
 * Re-key chain: each rotate's enc_prev = AEAD(newTransitKey, oldTransitKey), so a current member
 * walks back to decrypt transit from any prior epoch; a revoked member cannot. Rotate only re-wraps
 * the transit key (O(members)); content is never re-encrypted (transport-only encryption).
 *
 * Signatures are the actor Ed25519 key; transit-key wrapping uses the dual-use X25519 derived from
 * each actor's Ed25519 key. Signatures cover the deterministic proto3 encoding of
 * the record's `body` (the wrapped set is `repeated MemberWrap`, ordered — so the signed bytes are
 * canonical). The actor key is mnemonic-derived and does not rotate, so the root is self-signed and
 * "same actorId" is cryptographic continuity (no masterKey co-sign).
 */

/** The reserved sync docId for the membership log. The log is a PUBLIC signed roster (transit keys
 *  inside it are per-member wrapped, so the log itself isn't secret) → it rides the broker's plaintext
 *  envelope so a joining device can read it BEFORE it holds the transit key (bootstrap). */
export const MEMBERSHIP_DOC_ID = "membership";

const LOG_CONTAINER = "membership_log";

export type Member = {
  /** Raw 32-byte Ed25519 public key (verifies this member's signatures). */
  signPub: Uint8Array;
  /** Raw 32-byte X25519 public key (dual-use; the transit key is wrapped to this). */
  encPub: Uint8Array;
  epoch: number;
  /** The current-epoch transit key, sealed to encPub. */
  wrappedTransit: Uint8Array;
};

export type MembershipState = {
  owner: string;
  members: Map<string, Member>;
  currentEpoch: number;
};

/** A member's public identity — the owner knows each member's sign + enc pubkeys; the private key
 *  never leaves the member's device. The single input shape for `appendAdd` and `appendRotate`. */
export type MemberPublicKeys = { actorId: string; signPub: Uint8Array; encPub: Uint8Array };

export class MembershipLog {
  readonly doc: LoroDoc;
  private readonly list: LoroList;
  private readonly persistence?: MembershipPersistence;
  /** Encoded frontiers of the last persisted snapshot — the dirty-check baseline. */
  private lastPersisted?: Uint8Array;
  /** Last-seen skipped-record count. `deriveState` runs every round (via `sec.refresh`), so we warn
   *  only when NEW corruption appears (count rises) — mirrors any-sync's synclogger "always log on
   *  change", not a per-instance boolean that would hide a second, later corruption. */
  private skipLastCount = 0;

  constructor(doc: LoroDoc = new LoroDoc(), persistence?: MembershipPersistence) {
    this.doc = doc;
    this.list = doc.getList(LOG_CONTAINER);
    this.persistence = persistence;
  }

  /** Load the persisted membership snapshot into this log's doc. Returns whether bytes were loaded.
   *  Seeds `lastPersisted` so the loaded state isn't immediately re-written. No-op without a handle. */
  async load(): Promise<boolean> {
    if (!this.persistence) {
      return false;
    }
    const bytes = await this.persistence.load();
    if (!bytes) {
      return false;
    }
    this.doc.import(bytes);
    this.lastPersisted = encodeFrontiers(this.doc.oplogFrontiers());
    return true;
  }

  /** Persist a deep snapshot IF the doc advanced since the last persist. No-op without a handle or
   *  when frontiers are unchanged (membership changes rarely → most rounds skip the write). */
  async persistIfDirty(): Promise<void> {
    if (!this.persistence) {
      return;
    }
    const frontiers = encodeFrontiers(this.doc.oplogFrontiers());
    if (this.lastPersisted && sameBytes(frontiers, this.lastPersisted)) {
      return;
    }
    await this.persistence.save(this.doc.export({ mode: "snapshot" }));
    this.lastPersisted = frontiers;
  }

  records(): MembershipRecord[] {
    return this.list
      .toArray()
      .map((s) => fromBinary(MembershipRecordSchema, Buffer.from(s as string, "base64")));
  }

  private append(rec: MembershipRecord): void {
    this.list.push(Buffer.from(toBinary(MembershipRecordSchema, rec)).toString("base64"));
    this.doc.commit();
  }

  /** The log as a `SyncDoc` (id `MEMBERSHIP_DOC_ID`) so a transport can exchange it like any doc.
   *  Mirrors `ShardedBlockStore`'s per-doc adapter. The transport serves this on the push-apply path
   *  only (never in its profile — see DaemonSyncRunner), so SyncManager never mistakes the membership
   *  doc for a shard. */
  toSyncDoc(): SyncDoc {
    const doc = this.doc;
    return {
      id: MEMBERSHIP_DOC_ID,
      version: () => doc.version(),
      exportUpdate: (from) => doc.export(from ? { mode: "update", from } : { mode: "update" }),
      exportSnapshot: () => doc.export({ mode: "snapshot" }),
      importUpdate: (bytes) => {
        doc.import(bytes);
      },
    };
  }

  // ── record builders (owner signs + appends) ────────────────────────────────────

  /** Create the workspace: owner self-signs; the transit key wrapped to the owner. */
  appendRoot(owner: ActorKeypair, transitKey: Uint8Array): void {
    const ownerEncPub = actorEncryptionPublic(owner.publicKey);
    this.appendSigned(owner, {
      case: "root",
      value: create(RootRecordSchema, {
        owner: owner.actorId,
        ownerSignPub: owner.publicKey,
        ownerEncPub,
        wrappedTransit: wrapKey(ownerEncPub, transitKey),
        epoch: 0,
      }),
    });
  }

  /** Owner adds a member; the current transit key wrapped to them. `epoch` should be the current
   *  epoch (deriveState().state.currentEpoch) at add time — it records when the member joined. Only the
   *  member's public identity is needed (their private key never leaves their device). */
  appendAdd(
    owner: ActorKeypair,
    member: MemberPublicKeys,
    transitKey: Uint8Array,
    epoch: number,
  ): void {
    this.appendSigned(owner, {
      case: "add",
      value: create(AddRecordSchema, {
        actor: member.actorId,
        signPub: member.signPub,
        encPub: member.encPub,
        wrappedTransit: wrapKey(member.encPub, transitKey),
        epoch,
      }),
    });
  }

  /** Owner re-keys. `survivors` IS the new membership: listed members get the new transit key; anyone
   *  omitted is revoked (atomic removeAndRotate). The owner must be a survivor — they cannot rotate
   *  themselves out (the owner is always a member). encPrev chains the old key under the new (stored
   *  on the rotate record for future history decryption; not projected into state until something
   *  reads it). */
  appendRotate(
    owner: ActorKeypair,
    survivors: MemberPublicKeys[],
    newKey: Uint8Array,
    oldKey: Uint8Array,
    newEpoch: number,
  ): void {
    if (!survivors.some((s) => s.actorId === owner.actorId)) {
      throw new Error("appendRotate: survivors must include the owner");
    }
    this.appendSigned(owner, {
      case: "rotate",
      value: create(RotateRecordSchema, {
        epoch: newEpoch,
        wrapped: survivors.map((s) =>
          create(MemberWrapSchema, {
            actorId: s.actorId,
            signPub: s.signPub,
            encPub: s.encPub,
            wrappedTransit: wrapKey(s.encPub, newKey),
          }),
        ),
        encPrev: aeadEncrypt(newKey, oldKey),
      }),
    });
  }

  /** Owner transfers ownership to an existing member. The new owner already holds the transit key;
   *  only governance authority moves. The old owner stays on as a member. */
  appendTransfer(owner: ActorKeypair, newOwnerActorId: string): void {
    this.appendSigned(owner, {
      case: "transfer",
      value: create(TransferRecordSchema, { newOwner: newOwnerActorId }),
    });
  }

  /** Sign a record body with the owner's key and append the full MembershipRecord. */
  private appendSigned(owner: ActorKeypair, body: MembershipRecord["body"]): void {
    const sig = signWithActor(owner.privateKey, bodyBytes(body));
    this.append(create(MembershipRecordSchema, { signer: owner.actorId, sig, body }));
  }

  // ── state derivation / decryption ───────────────────────────────────────────────

  /** Replay every record into a membership state + the records that were skipped. The replay rules
   *  (signature + owner authorization + the authority-independent invariants) live in
   *  `membership-replay.ts`. Deterministic given the merged list → every replica converges. */
  deriveState(): { state: MembershipState; skipped: MembershipRecord[] } {
    const result = deriveMembershipState(this.list.toArray());
    if (result.skipped.length > this.skipLastCount) {
      // New corruption appeared since the last round — surface it. A stable count stays quiet
      // (per-round dedup); a heal (count falling) updates silently. Turn up engine=debug for every
      // occurrence. A malformed/garbage entry can't be a valid record — skipped, never aborts replay.
      log.warn("skipped malformed membership records during replay", {
        count: result.skipped.length,
      });
    }
    this.skipLastCount = result.skipped.length;
    return result;
  }

  /** A member unwraps its current-epoch transit key. */
  unwrapCurrentTransitKey(state: MembershipState, member: ActorKeypair): Uint8Array {
    const m = state.members.get(member.actorId);
    if (!m) {
      throw new Error(`not a member: ${member.actorId}`);
    }
    return unwrapKey(actorEncryptionPrivate(member.privateKey), m.wrappedTransit);
  }

  /** Owner-only governance: add a member (their raw Ed25519 sign pub) at the current epoch. Composes
   *  `deriveState` + the owner guard + transit-key unwrap + `appendAdd`. Throws if `owner` isn't the
   *  workspace owner. Only the member's public identity is needed; their private key never leaves their
   *  device. Does NOT persist — the caller flushes via `persistIfDirty()`, like the raw appends. */
  addMember(owner: ActorKeypair, memberSignPub: Uint8Array): void {
    const { state } = this.deriveState();
    if (state.owner === "") {
      throw new Error("addMember: workspace has no owner root");
    }
    if (state.owner !== owner.actorId) {
      throw new Error("addMember: only the owner can add members");
    }
    const transitKey = this.unwrapCurrentTransitKey(state, owner);
    this.appendAdd(
      owner,
      {
        actorId: actorIdFromPublicKey(memberSignPub),
        signPub: memberSignPub,
        encPub: actorEncryptionPublic(memberSignPub),
      },
      transitKey,
      state.currentEpoch,
    );
  }
}

/** Constant-time-unconcerned byte equality for the dirty-check baseline (frontiers are not secret). */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

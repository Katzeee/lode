import { LoroDoc, type LoroList } from "loro-crdt";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  aeadEncrypt,
  actorEncryptionPrivate,
  actorEncryptionPublic,
  signWithActor,
  unwrapKey,
  verifyActorSignature,
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

  constructor(doc: LoroDoc = new LoroDoc()) {
    this.doc = doc;
    this.list = doc.getList(LOG_CONTAINER);
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

  /** Replay every record, verifying signatures + owner authorization. A record is SKIPPED (not
   *  fatal) if it can't be decoded, its signature fails, its signer is unknown, its signer isn't the
   *  current owner, it's a `root` after the first one, it's a `transfer` to a non-member, or (rotate)
   *  its epoch isn't strictly ahead of the current. Deterministic given the merged list → every
   *  replica converges. */
  deriveState(): { state: MembershipState; skipped: MembershipRecord[] } {
    const state: MembershipState = {
      owner: "",
      members: new Map(),
      currentEpoch: -1,
    };
    const skipped: MembershipRecord[] = [];
    for (const raw of this.list.toArray()) {
      let rec: MembershipRecord;
      try {
        rec = fromBinary(MembershipRecordSchema, Buffer.from(raw as string, "base64"));
      } catch {
        // An undecodable entry (e.g. a malformed/garbage push from a bad replica) can't be a valid
        // record — skip it, never let it abort the replay.
        continue;
      }
      const sigOk = verifySignature(state, rec);
      // A root self-authorizes ONLY as the first record (state.owner === "" → no root seen yet); a
      // later root is skipped, so a former owner can't re-seize governance by appending a new root.
      // Any other record must be signed by the current owner.
      const authOk = rec.body.case === "root" ? state.owner === "" : rec.signer === state.owner;
      const staleRotate = rec.body.case === "rotate" && rec.body.value.epoch <= state.currentEpoch;
      // Transfer must target an existing member (design §2: transfer to an existing member); otherwise
      // it would leave the workspace with an owner who holds no transit key (bricked governance).
      const transferTargetUnknown =
        rec.body.case === "transfer" && !state.members.has(rec.body.value.newOwner);
      if (!sigOk || !authOk || staleRotate || transferTargetUnknown) {
        skipped.push(rec);
        continue;
      }
      apply(state, rec);
    }
    return { state, skipped };
  }

  /** A member unwraps its current-epoch transit key. */
  unwrapCurrentTransitKey(state: MembershipState, member: ActorKeypair): Uint8Array {
    const m = state.members.get(member.actorId);
    if (!m) {
      throw new Error(`not a member: ${member.actorId}`);
    }
    return unwrapKey(actorEncryptionPrivate(member.privateKey), m.wrappedTransit);
  }
}

// ── replay apply ──────────────────────────────────────────────────────────────────

function apply(state: MembershipState, rec: MembershipRecord): void {
  if (rec.body.case === "root") {
    const b = rec.body.value;
    state.owner = b.owner;
    state.members.set(b.owner, {
      signPub: b.ownerSignPub,
      encPub: b.ownerEncPub,
      epoch: b.epoch,
      wrappedTransit: b.wrappedTransit,
    });
    state.currentEpoch = b.epoch;
  } else if (rec.body.case === "add") {
    const b = rec.body.value;
    state.members.set(b.actor, {
      signPub: b.signPub,
      encPub: b.encPub,
      epoch: b.epoch,
      wrappedTransit: b.wrappedTransit,
    });
  } else if (rec.body.case === "rotate") {
    const b = rec.body.value;
    // The wrapped set IS the new membership: members omitted are revoked.
    const survivors = new Set(b.wrapped.map((w) => w.actorId));
    for (const actorId of [...state.members.keys()]) {
      if (!survivors.has(actorId)) {
        state.members.delete(actorId);
      }
    }
    for (const w of b.wrapped) {
      const m = state.members.get(w.actorId);
      if (m) {
        m.wrappedTransit = w.wrappedTransit;
        m.epoch = b.epoch;
      }
    }
    state.currentEpoch = b.epoch;
  } else if (rec.body.case === "transfer") {
    // Ownership moves to a current member (enforced before apply); they're already in `members`, so
    // their signPub is found there for governance verification. (The owner is always a member.)
    state.owner = rec.body.value.newOwner;
  }
}

// ── signature verification + canonical body encoding ─────────────────────────────

/** Verify a record's signature. Root self-authorizes (via its embedded owner_sign_pub); every other
 *  record is owner-signed, and the owner is always a member, so their signPub lives in `members`. A
 *  non-owner signer's record is skipped by the auth check regardless. `verifyActorSignature` returns
 *  false on any malformed input (including a missing/empty pubkey), so no extra guard is needed. */
function verifySignature(state: MembershipState, rec: MembershipRecord): boolean {
  if (rec.body.case === undefined) {
    return false;
  }
  const signPub =
    rec.body.case === "root" ? rec.body.value.ownerSignPub : state.members.get(rec.signer)?.signPub;
  return signPub !== undefined && verifyActorSignature(signPub, bodyBytes(rec.body), rec.sig);
}

/** The canonical bytes a record's signature commits to: the deterministic proto3 encoding of its body
 * (signer + sig excluded). `repeated` fields keep insertion order, so the wrapped set is canonical. */
function bodyBytes(body: MembershipRecord["body"]): Uint8Array {
  switch (body.case) {
    case "root":
      return toBinary(RootRecordSchema, body.value);
    case "add":
      return toBinary(AddRecordSchema, body.value);
    case "rotate":
      return toBinary(RotateRecordSchema, body.value);
    case "transfer":
      return toBinary(TransferRecordSchema, body.value);
    case undefined:
      return new Uint8Array(0);
  }
}

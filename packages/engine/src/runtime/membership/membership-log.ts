import { LoroDoc, type LoroList } from "loro-crdt";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { aeadDecrypt, aeadEncrypt } from "../../utils/crypto/aes.js";
import {
  actorEncryptionPrivate,
  actorEncryptionPublic,
  unwrapKey,
  wrapKey,
} from "../../identity/actor-encryption.js";
import {
  signWithActor,
  verifyActorSignature,
  type ActorKeypair,
} from "../../identity/actor-key.js";
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
 * syncs like any other (exportBytes/importBytes here; SyncManager wiring lands in T4 — the log is a
 * separate Loro doc, not yet in the ShardedBlockStore synced-doc set). A record is
 * SKIPPED at replay (not fatal) if its signature fails, its signer is unknown, its signer isn't the
 * current owner, or (rotate) its epoch isn't strictly ahead of the current. Deterministic given the
 * merged list → every replica converges. Owner-only governance means there is no multi-admin
 * concurrent conflict to resolve.
 *
 * Re-key chain: each rotate's enc_prev = AEAD(newTransitKey, oldTransitKey), so a current member
 * walks back to decrypt transit from any prior epoch; a revoked member cannot. Rotate only re-wraps
 * the transit key (O(members)); content is never re-encrypted (transport-only encryption).
 *
 * Production crypto (F3b): signatures via the actor Ed25519 key; transit-key wrapping via the dual-use
 * X25519 derived from each actor's Ed25519 key. Signatures cover the deterministic proto3 encoding of
 * the record's `body` (the wrapped set is `repeated MemberWrap`, ordered — so the signed bytes are
 * canonical). The actor key is mnemonic-derived and does not rotate, so the root is self-signed and
 * "same actorId" is cryptographic continuity (no masterKey co-sign).
 */

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
  /** The owner's Ed25519 signPub, tracked independently of `members` so the owner can still sign
   *  governance (e.g. re-add themselves) even when a rotate has dropped them from `members`. */
  ownerSignPub: Uint8Array;
  members: Map<string, Member>;
  currentEpoch: number;
  /** Rotate records by epoch, for the history-chain walk. */
  rotates: Map<number, { encPrev: Uint8Array }>;
};

/** Input shape for a rotate survivor: the owner knows each survivor's public keys. */
export type Survivor = { actorId: string; signPub: Uint8Array; encPub: Uint8Array };

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

  exportBytes(): Uint8Array {
    return this.doc.export({ mode: "snapshot" });
  }

  importBytes(bytes: Uint8Array): void {
    this.doc.import(bytes);
  }

  // ── record builders (owner signs + appends) ────────────────────────────────────

  /** Create the workspace: owner self-signs; the transit key wrapped to the owner. */
  appendRoot(owner: ActorKeypair, transitKey: Uint8Array): void {
    this.appendSigned(owner, {
      case: "root",
      value: create(RootRecordSchema, {
        owner: owner.actorId,
        ownerSignPub: owner.publicKey,
        ownerEncPub: actorEncryptionPublic(owner.publicKey),
        wrappedTransit: wrapKeyTo(owner.publicKey, transitKey),
        epoch: 0,
      }),
    });
  }

  /** Owner adds a member; the current transit key wrapped to them. `epoch` should be the current
   *  epoch (deriveState().state.currentEpoch) at add time — it records when the member joined. */
  appendAdd(
    owner: ActorKeypair,
    member: ActorKeypair,
    transitKey: Uint8Array,
    epoch: number,
  ): void {
    this.appendSigned(owner, {
      case: "add",
      value: create(AddRecordSchema, {
        actor: member.actorId,
        signPub: member.publicKey,
        encPub: actorEncryptionPublic(member.publicKey),
        wrappedTransit: wrapKeyTo(member.publicKey, transitKey),
        epoch,
      }),
    });
  }

  /** Owner re-keys. `survivors` IS the new membership: listed members get the new transit key; anyone
   *  omitted is revoked (atomic removeAndRotate). encPrev chains the old key under the new so current
   *  members can walk back to decrypt history. */
  appendRotate(
    owner: ActorKeypair,
    survivors: Survivor[],
    newKey: Uint8Array,
    oldKey: Uint8Array,
    newEpoch: number,
  ): void {
    this.appendSigned(owner, {
      case: "rotate",
      value: create(RotateRecordSchema, {
        epoch: newEpoch,
        wrapped: survivors.map((s) =>
          create(MemberWrapSchema, {
            actorId: s.actorId,
            signPub: s.signPub,
            encPub: s.encPub,
            wrappedTransit: wrapKeyToEncPub(s.encPub, newKey),
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
      ownerSignPub: new Uint8Array(0),
      members: new Map(),
      currentEpoch: -1,
      rotates: new Map(),
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
      if (rec.body.case === undefined) {
        skipped.push(rec);
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
    return unwrapKeyFromPriv(member.privateKey, m.wrappedTransit);
  }

  /** Walk the re-key chain back to `targetEpoch` (< current). Each rotate's encPrev decrypts the
   *  prior epoch's transit key under the current one. NB: the chain is a single shared sequence, so a
   *  member who can unwrap the current key recovers transit for EVERY prior epoch — including ones
   *  before they joined. That is the intended MVP recovery model (full history via the chain, design
   *  §9); per-epoch member-bounded secrecy is a future refinement. */
  walkHistoryTransitKey(
    state: MembershipState,
    member: ActorKeypair,
    targetEpoch: number,
  ): Uint8Array {
    if (targetEpoch > state.currentEpoch) {
      throw new Error(
        `target epoch ${targetEpoch} is in the future (current ${state.currentEpoch})`,
      );
    }
    let key = this.unwrapCurrentTransitKey(state, member);
    let epoch = state.currentEpoch;
    while (epoch > targetEpoch) {
      const rot = state.rotates.get(epoch);
      if (!rot) {
        throw new Error(`missing rotate record for epoch ${epoch}`);
      }
      key = aeadDecrypt(key, rot.encPrev);
      epoch--;
    }
    return key;
  }
}

// ── replay apply ──────────────────────────────────────────────────────────────────

function apply(state: MembershipState, rec: MembershipRecord): void {
  if (rec.body.case === "root") {
    const b = rec.body.value;
    state.owner = b.owner;
    state.ownerSignPub = b.ownerSignPub;
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
    state.rotates.set(b.epoch, { encPrev: b.encPrev });
    state.currentEpoch = b.epoch;
  } else if (rec.body.case === "transfer") {
    // The new owner is a current member (enforced before apply); capture their signPub so governance
    // signature verification follows the owner even if a later rotate drops them from `members`.
    state.owner = rec.body.value.newOwner;
    const newOwnerMember = state.members.get(rec.body.value.newOwner);
    if (newOwnerMember) {
      state.ownerSignPub = newOwnerMember.signPub;
    }
  }
}

// ── signature verification + canonical body encoding ─────────────────────────────

/** Verify a record's signature. Root self-authorizes (via its own ownerSignPub); every other record is
 *  owner-signed, verified against `state.ownerSignPub` (tracked independently of `members`, so the
 *  owner can still sign governance — e.g. re-add themselves — even when a rotate has dropped them from
 *  the member set). A non-owner signer's record is skipped by the auth check regardless. */
function verifySignature(state: MembershipState, rec: MembershipRecord): boolean {
  if (rec.body.case === undefined) {
    return false;
  }
  const signPub =
    rec.body.case === "root"
      ? rec.body.value.ownerSignPub
      : rec.signer === state.owner
        ? state.ownerSignPub
        : state.members.get(rec.signer)?.signPub;
  if (!signPub || signPub.length === 0) {
    return false;
  }
  return verifyActorSignature(signPub, bodyBytes(rec.body), rec.sig);
}

/** The canonical bytes a record's signature commits to: the deterministic proto3 encoding of its body
 *  (signer + sig excluded). `repeated` fields keep insertion order, so the wrapped set is canonical. */
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

// ── transit-key wrapping helpers (dual-use: X25519 derived from the actor Ed25519 key) ─

/** Wrap a transit key to an actor's Ed25519 public (converted to its X25519 public). */
function wrapKeyTo(ed25519Pub: Uint8Array, transitKey: Uint8Array): Uint8Array {
  return wrapKey(actorEncryptionPublic(ed25519Pub), transitKey);
}

/** Wrap a transit key directly to an X25519 public (used by rotate, which already has encPub). */
function wrapKeyToEncPub(encPub: Uint8Array, transitKey: Uint8Array): Uint8Array {
  return wrapKey(encPub, transitKey);
}

/** Unwrap a transit key held by an actor (X25519 private derived from the actor's Ed25519 seed). */
function unwrapKeyFromPriv(
  privateKey: ActorKeypair["privateKey"],
  wrapped: Uint8Array,
): Uint8Array {
  return unwrapKey(actorEncryptionPrivate(privateKey), wrapped);
}

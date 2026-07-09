import { randomBytes } from "node:crypto";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { createLogger } from "@lode/logger";
import type { MembershipPersistence } from "./membership-persistence.js";
import { actorHasPeer, bodyBytes, deriveMembershipState } from "./membership-replay.js";
import {
  aeadEncrypt,
  signWithActor,
  unwrapKey,
  wrapKey,
  type ActorKeypair,
  type PeerKeypair,
} from "../../utils/crypto/index.js";
import { sameBytes } from "../../utils/bytes.js";
import type { MetaDoc } from "../../core/store/meta-doc.js";
import { NotOwnerError, PreconditionFailedError } from "../../errors.js";
import {
  AddRecordSchema,
  PeerWrapSchema,
  MembershipRecordSchema,
  RootRecordSchema,
  RotateRecordSchema,
  TransferRecordSchema,
  type MembershipRecord,
} from "@lode/protocol/proto";

const log = createLogger("engine.membership");

/**
 * The membership log — the in-process sync core's membership half (design sync-identity-persistence
 * §2 + §13). NOT an ACL: lode has no authoritative server, so this is a replicated, signed, append-only
 * log of which PEERS are in a workspace, who owns it, and each peer's transit key. Two roles only:
 * owner (the single governance authority) + member(rw).
 *
 * Peer model (§13): the membership unit is the peer (one peerId). Each admitted peer carries a
 * random X25519 enc pub; the owner wraps the transit key to it; the peer unwraps with its private
 * scalar. Revocation = rotate omits the peerId. The ACTOR key signs everything (wire
 * attribution + governance + self-service-add); actorId is the hex of the Ed25519 sign pub, so the
 * sign pub is recovered from the signer's actorId at verify time (records carry no sign pub field).
 *
 * Records are protobuf (MembershipRecord) bytes in a `MetaDoc`'s append-only log, so the log is
 * itself a syncable doc (a CRDT whose loro backing lives in core). A record is SKIPPED at replay
 * isn't authorized (owner for governance; the owning actor for a self-service add), it's a `root`
 * after the first, it's a `transfer` to a non-member actor or to the current owner, it's a `rotate`
 * whose epoch isn't strictly ahead or that drops every owner peer, or it's an `add` whose join epoch
 * trails the current (staleAdd). Deterministic given the merged list → every replica converges.
 *
 * Signatures cover the deterministic proto3 encoding of the record's `body` (the wrapped set is
 * `repeated PeerWrap`, ordered — so the signed bytes are canonical). The actor key is
 * mnemonic-derived and does not rotate, so the root is self-signed and "same actorId" is cryptographic
 * continuity (no masterKey co-sign).
 */

/** The reserved sync docId for the membership log. The log is a PUBLIC signed roster (transit keys
 *  inside it are per-peer wrapped, so the log itself isn't secret) → it rides the broker's plaintext
 *  envelope so a joining peer can read it BEFORE it holds the transit key (bootstrap). */
export const MEMBERSHIP_DOC_ID = "membership";

/** One admitted peer in the replayed state. The transit key is wrapped to `peerEncPub`. */
export type Peer = {
  /** Hex Ed25519 pub of the owning actor (attribution; the actor signs, the peer never does). */
  owningActorId: string;
  /** 32-byte X25519 — the transit key is wrapped to this. */
  peerEncPub: Uint8Array;
  epoch: number;
  /** The current-epoch transit key, sealed to peerEncPub. */
  wrappedTransit: Uint8Array;
  /** Human label ("Alice's laptop"); set at admission, advisory (UI-only). */
  peerName: string;
};

export type MembershipState = {
  owner: string;
  /** Keyed by peerId — the membership/revocation unit. */
  peers: Map<string, Peer>;
  currentEpoch: number;
};

/** A peer's public identity — the single input shape for `appendAdd` and `appendRotate`. The owner
 *  knows each peer — peerId + owning actor + X25519 enc pub; the peer private key never leaves the
 *  peer. */
export type PeerPublicKeys = {
  peerId: string;
  owningActorId: string;
  peerEncPub: Uint8Array;
  peerName: string;
};

/** The local replica's identity bundle: the actor (signs) + the peer (unwraps transit) + peerId.
 *  The actor is always present in-session (CLI/GUI login); the peer key is loaded per-dataRoot. */
export type LocalPeer = {
  readonly actor: ActorKeypair;
  readonly peer: PeerKeypair;
  readonly peerId: string;
};

export class MembershipLog {
  /** The backing CRDT doc (a `MetaDoc`: an append-only record log that is itself a `SyncableDoc`).
   *  Injected by the composition root so this module names no CRDT backend. Public so tests can
   *  inject raw/forged records to probe replay; production goes through the builders below. */
  readonly metaDoc: MetaDoc;
  private readonly persistence?: MembershipPersistence;
  /** Encoded frontiers of the last persisted snapshot — the dirty-check baseline. */
  private lastPersisted?: Uint8Array;
  /** Last-seen skipped-record count. `deriveState` runs whenever the log's frontier moves (the lazy
   *  wire-security projection re-derives on read), so we warn only when NEW corruption appears
   *  (count rises) — mirrors any-sync's synclogger "always log on change", not a per-instance boolean
   *  that would hide a second, later corruption. */
  private skipLastCount = 0;

  constructor(metaDoc: MetaDoc, persistence?: MembershipPersistence) {
    this.metaDoc = metaDoc;
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
    await this.metaDoc.importUpdate(bytes);
    this.lastPersisted = this.metaDoc.frontiers();
    return true;
  }

  /** Persist a deep snapshot IF the doc advanced since the last persist. No-op without a handle or
   *  when frontiers are unchanged (membership changes rarely → most rounds skip the write). */
  async persistIfDirty(): Promise<void> {
    if (!this.persistence) {
      return;
    }
    const frontiers = this.metaDoc.frontiers();
    if (this.lastPersisted && sameBytes(frontiers, this.lastPersisted)) {
      return;
    }
    await this.persistence.save(await this.metaDoc.exportSnapshot());
    this.lastPersisted = frontiers;
  }

  records(): MembershipRecord[] {
    return this.metaDoc.records().map((bytes) => fromBinary(MembershipRecordSchema, bytes));
  }

  private append(rec: MembershipRecord): void {
    this.metaDoc.appendRecord(toBinary(MembershipRecordSchema, rec));
    this.metaDoc.commit();
  }

  // ── record builders ────────────────────────────────────────────────────────────

  /** Create the workspace: the owner's actor self-signs; the transit key wrapped to the owner's FIRST
   *  peer. Only the owner's actor key signs (governance); the owner's peer enc pub + peerId seed
   *  the peer roster. `peerName` is the owner's first peer's human label (advisory, UI-only). */
  appendRoot(owner: LocalPeer, transitKey: Uint8Array, peerName: string): void {
    this.appendSigned(owner.actor, {
      case: "root",
      value: create(RootRecordSchema, {
        owner: owner.actor.actorId,
        ownerPeerEncPub: owner.peer.publicKey,
        ownerPeerId: owner.peerId,
        wrappedTransit: wrapKey(owner.peer.publicKey, transitKey),
        epoch: 0,
        peerName,
      }),
    });
  }

  /** Add a peer. `signer` is the actor signing: the OWNER (adding an actor's first peer or any
   *  peer) OR the owning actor themselves (self-service — `signer.actorId === peer.owningActorId`).
   *  The replay authorizes both. `transitKey` is the raw current-epoch transit key (the caller unwrapped
   *  it); it is wrapped to the new peer's enc pub. `epoch` should be the current epoch. */
  appendAdd(
    signer: ActorKeypair,
    peer: PeerPublicKeys,
    transitKey: Uint8Array,
    epoch: number,
  ): void {
    this.appendSigned(signer, {
      case: "add",
      value: create(AddRecordSchema, {
        owningActor: peer.owningActorId,
        peerEncPub: peer.peerEncPub,
        peerId: peer.peerId,
        wrappedTransit: wrapKey(peer.peerEncPub, transitKey),
        epoch,
        peerName: peer.peerName,
      }),
    });
  }

  /** Owner re-keys. `survivors` IS the new peer roster: listed peers get the new transit key; any
   *  peer omitted is revoked (atomic removeAndRotate). The owner must keep ≥1 surviving peer —
   *  governance signs with the actor key (always held), but reading/producing content needs the peer
   *  key to unwrap transit, so dropping every owner peer would brick the workspace. encPrev chains
   *  the old key under the new. */
  appendRotate(
    owner: ActorKeypair,
    survivors: PeerPublicKeys[],
    newKey: Uint8Array,
    oldKey: Uint8Array,
    newEpoch: number,
  ): void {
    if (!survivors.some((s) => s.owningActorId === owner.actorId)) {
      throw new PreconditionFailedError("appendRotate: survivors must include a peer of the owner");
    }
    this.appendSigned(owner, {
      case: "rotate",
      value: create(RotateRecordSchema, {
        epoch: newEpoch,
        wrapped: survivors.map((s) =>
          create(PeerWrapSchema, {
            peerId: s.peerId,
            owningActorId: s.owningActorId,
            peerEncPub: s.peerEncPub,
            wrappedTransit: wrapKey(s.peerEncPub, newKey),
            peerName: s.peerName,
          }),
        ),
        encPrev: aeadEncrypt(newKey, oldKey),
      }),
    });
  }

  /** Owner transfers ownership to an actor that already owns ≥1 peer (so the new owner already holds
   *  the transit key). Only governance authority moves; the old owner's peers stay admitted. */
  appendTransfer(owner: ActorKeypair, newOwnerActorId: string): void {
    this.appendSigned(owner, {
      case: "transfer",
      value: create(TransferRecordSchema, { newOwner: newOwnerActorId }),
    });
  }

  /** Sign a record body with the signer actor's key and append the full MembershipRecord. */
  private appendSigned(signer: ActorKeypair, body: MembershipRecord["body"]): void {
    const sig = signWithActor(signer.privateKey, bodyBytes(body));
    this.append(create(MembershipRecordSchema, { signer: signer.actorId, sig, body }));
  }

  // ── state derivation / decryption ───────────────────────────────────────────────

  /** Replay every record into a membership state + the records that were skipped. The replay rules
   *  (signature + authorization + the authority-independent invariants) live in
   *  `membership-replay.ts`. Deterministic given the merged list → every replica converges. */
  deriveState(): { state: MembershipState; skipped: MembershipRecord[] } {
    const result = deriveMembershipState(this.metaDoc.records());
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

  /** The local peer unwraps its current-epoch transit key. Throws if this peer isn't admitted. */
  unwrapCurrentTransitKey(state: MembershipState, local: LocalPeer): Uint8Array {
    const d = state.peers.get(local.peerId);
    if (!d) {
      throw new PreconditionFailedError(`peer not admitted: ${local.peerId}`);
    }
    return unwrapKey(local.peer.privateKey, d.wrappedTransit);
  }

  /** Owner-only governance: add a peer at the current epoch. Composes `deriveState` + the owner
   *  guard + transit-key unwrap (via the owner's own peer) + `appendAdd`. Throws if `owner` isn't
   *  the workspace owner. Does NOT persist — the caller flushes via `persistIfDirty()`. */
  addMember(owner: LocalPeer, newPeer: PeerPublicKeys): void {
    const { state } = this.deriveState();
    if (state.owner === "") {
      throw new PreconditionFailedError("addMember: workspace has no owner root");
    }
    if (state.owner !== owner.actor.actorId) {
      throw new NotOwnerError("addMember: only the owner can add members");
    }
    const transitKey = this.unwrapCurrentTransitKey(state, owner);
    this.appendAdd(owner.actor, newPeer, transitKey, state.currentEpoch);
  }

  // ── governance conveniences (compose deriveState + a guard + unwrap + append*) ─────────
  // Each throws a clear error on the wrong caller; the replay is the authority of last resort
  // (its owner-guard / self-service rule re-checks). Callers flush via `persistIfDirty()`.

  /** Owner re-keys to exactly `survivors` (the full new roster). Any peer omitted is revoked.
   *  Owner-only. Generates a fresh transit key. */
  private rotateTo(owner: LocalPeer, survivors: PeerPublicKeys[]): void {
    const { state } = this.deriveState();
    if (state.owner === "") {
      throw new PreconditionFailedError("rotateTo: workspace has no owner root");
    }
    if (state.owner !== owner.actor.actorId) {
      throw new NotOwnerError("rotateTo: only the owner can re-key");
    }
    if (!survivors.some((s) => s.owningActorId === owner.actor.actorId)) {
      throw new PreconditionFailedError(
        "cannot drop every peer of the owner — governance would be bricked",
      );
    }
    const oldKey = this.unwrapCurrentTransitKey(state, owner);
    const newKey = randomBytes(32);
    this.appendRotate(owner.actor, survivors, newKey, oldKey, state.currentEpoch + 1);
  }

  /** Owner revokes one peer (rotate omitting it). Throws if the peerId isn't admitted. */
  revokePeer(owner: LocalPeer, peerId: string): void {
    const { state } = this.deriveState();
    const survivors = rosterSurvivors(state, (id) => id !== peerId);
    if (survivors.length === state.peers.size) {
      throw new PreconditionFailedError(`revokePeer: peer not admitted: ${peerId}`);
    }
    this.rotateTo(owner, survivors);
  }

  /** Owner revokes every peer of an actor (they leave the workspace). Throws if the actor has no
   *  admitted peers, or if revoking them would drop every owner peer (e.g. revoking the owner's own
   *  actorId). */
  revokeActor(owner: LocalPeer, actorId: string): void {
    const { state } = this.deriveState();
    const survivors = rosterSurvivors(state, (_, p) => p.owningActorId !== actorId);
    if (survivors.length === state.peers.size) {
      throw new PreconditionFailedError(`revokeActor: actor has no admitted peers: ${actorId}`);
    }
    this.rotateTo(owner, survivors);
  }

  /** Owner manually re-keys (forward-secrecy rotation; same roster — no one revoked). */
  rotateTransit(owner: LocalPeer): void {
    const { state } = this.deriveState();
    this.rotateTo(
      owner,
      rosterSurvivors(state, () => true),
    );
  }

  /** An actor self-adds their own further peer (no owner round-trip). The signer is the session
   *  actor; `local` must be admitted (it unwraps the transit key). The replay's self-service rule
   *  authorizes (signer == owningActor AND owns ≥1 peer). */
  addSelfPeer(local: LocalPeer, newPeer: PeerPublicKeys): void {
    const { state } = this.deriveState();
    if (newPeer.owningActorId !== local.actor.actorId) {
      throw new PreconditionFailedError(
        "addSelfPeer: the new peer must be owned by the calling actor",
      );
    }
    const transitKey = this.unwrapCurrentTransitKey(state, local);
    this.appendAdd(local.actor, newPeer, transitKey, state.currentEpoch);
  }

  /** Owner transfers governance to an existing member actor. The target must already own ≥1 peer
   *  (so they can unwrap transit) and must not be the current owner. Throws a clear error for an
   *  empty / unknown / self target rather than silently appending a record the replay would skip. */
  transferOwnership(owner: LocalPeer, newOwnerActorId: string): void {
    const { state } = this.deriveState();
    if (state.owner !== owner.actor.actorId) {
      throw new NotOwnerError("transferOwnership: only the owner can transfer");
    }
    if (newOwnerActorId === "") {
      throw new PreconditionFailedError("transferOwnership: target actor is empty");
    }
    if (newOwnerActorId === owner.actor.actorId) {
      throw new PreconditionFailedError("transferOwnership: target is already the owner");
    }
    if (!actorHasPeer(state, newOwnerActorId)) {
      throw new PreconditionFailedError(
        `transferOwnership: target is not a member: ${newOwnerActorId}`,
      );
    }
    this.appendTransfer(owner.actor, newOwnerActorId);
  }
}

/** Build the survivor roster (`PeerPublicKeys[]`) from the replayed state, keeping entries where
 *  `keep` returns true. Carries `peerName` through (rotate re-attests each survivor's name). */
function rosterSurvivors(
  state: MembershipState,
  keep: (peerId: string, peer: Peer) => boolean,
): PeerPublicKeys[] {
  const out: PeerPublicKeys[] = [];
  for (const [peerId, p] of state.peers.entries()) {
    if (keep(peerId, p)) {
      out.push({
        peerId,
        owningActorId: p.owningActorId,
        peerEncPub: p.peerEncPub,
        peerName: p.peerName,
      });
    }
  }
  return out;
}

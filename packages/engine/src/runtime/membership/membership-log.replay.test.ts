import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  aeadDecrypt,
  aeadEncrypt,
  deriveActorKeypairFromMnemonic,
  generateActorKeypair,
  generatePeerKeypair,
  unwrapKey,
} from "../../crypto/index.js";
import {
  MembershipLog,
  MEMBERSHIP_DOC_ID,
  type PeerPublicKeys,
  type LocalPeer,
} from "./membership-log.js";
import { LoroMetaDoc } from "../../core/store/meta-doc.js";

/** Construct a MembershipLog backed by a fresh LoroMetaDoc (the production backing). */
const newLog = (persistence?: ConstructorParameters<typeof MembershipLog>[1]): MembershipLog =>
  new MembershipLog(new LoroMetaDoc(MEMBERSHIP_DOC_ID), persistence);

const newTransitKey = (): Uint8Array => randomBytes(32);
const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

let peerCounter = 1;
const newPeerId = (): string => String(peerCounter++);

/** A fresh local peer bundle: a random actor (signs) + a random peer X25519 key (unwraps) + a
 *  unique peerId. The peer key is independent of the actor key (design §13). */
const newLocal = (): LocalPeer => ({
  actor: generateActorKeypair(),
  peer: generatePeerKeypair(),
  peerId: newPeerId(),
});

/** The PeerPublicKeys a record carries for this local peer. */
const peerPub = (local: LocalPeer): PeerPublicKeys => ({
  peerId: local.peerId,
  owningActorId: local.actor.actorId,
  peerEncPub: local.peer.publicKey,
  peerName: "",
});

describe("membership log — replay rejection rules (CRDT-skip thesis)", () => {
  it("a stale rotate (epoch ≤ current) is skipped; currentEpoch is unchanged", () => {
    const owner = newLocal();
    const k0 = newTransitKey();
    const k1 = newTransitKey();
    const k0b = newTransitKey(); // would-be stale rotate key
    const log = newLog();
    log.appendRoot(owner, k0, "");
    log.appendRotate(owner.actor, [peerPub(owner)], k1, k0, 1);
    // A second rotate claiming epoch 1 (not strictly ahead of current=1) → skipped.
    log.appendRotate(owner.actor, [peerPub(owner)], k0b, k1, 1);

    const { state, skipped } = log.deriveState();
    expect(state.currentEpoch).toBe(1);
    expect(eq(log.unwrapCurrentTransitKey(state, owner), k1)).toBe(true); // stale key never applied
    expect(skipped.some((r) => r.body.case === "rotate")).toBe(true);
  });

  it("a forged transfer by a non-owner is skipped (ownership doesn't move)", () => {
    const owner = newLocal();
    const member = newLocal();
    const tk = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, tk, "");
    log.appendAdd(owner.actor, peerPub(member), tk, 0);
    log.appendTransfer(member.actor, member.actor.actorId); // member forges ownership to themselves

    const { state, skipped } = log.deriveState();
    expect(state.owner).toBe(owner.actor.actorId);
    expect(skipped.some((r) => r.body.case === "transfer")).toBe(true);
  });

  it("a second root (a former owner re-seizing governance) is skipped", () => {
    const owner = newLocal();
    const successor = newLocal();
    const tk = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, tk, "");
    log.appendAdd(owner.actor, peerPub(successor), tk, 0);
    log.appendTransfer(owner.actor, successor.actor.actorId);
    log.appendRoot(owner, newTransitKey(), ""); // old owner self-authorizes a fresh root → skipped

    const { state, skipped } = log.deriveState();
    expect(state.owner).toBe(successor.actor.actorId);
    expect(skipped.some((r) => r.body.case === "root")).toBe(true);
  });

  it("a transfer to a non-member (an actor with no admitted peer) is skipped", () => {
    const owner = newLocal();
    const stranger = newLocal(); // never added — owns no peer
    const tk = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, tk, "");
    log.appendTransfer(owner.actor, stranger.actor.actorId); // stranger was never added

    const { state, skipped } = log.deriveState();
    expect(state.owner).toBe(owner.actor.actorId); // transfer rejected
    expect(skipped.some((r) => r.body.case === "transfer")).toBe(true);
  });

  it("a stale add (join epoch < current) is skipped — closes the add-vs-rotate race", () => {
    // Self-service-add reopens one concurrent edge (§2/§13): an add racing a rotate-that-omits-the-
    // actor must not re-admit it on a stale transit. staleAdd (mirror of staleRotate) closes it.
    const owner = newLocal();
    const member = newLocal();
    const k0 = newTransitKey();
    const k1 = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, k0, "");
    log.appendAdd(owner.actor, peerPub(member), k0, 0); // member joins at epoch 0
    log.appendRotate(owner.actor, [peerPub(owner)], k1, k0, 1); // member revoked at epoch 1
    // A late add for the member, created at epoch 0 (before the rotate) — must NOT re-admit.
    log.appendAdd(owner.actor, peerPub(member), k0, 0);

    const { state, skipped } = log.deriveState();
    expect(state.peers.has(member.peerId)).toBe(false); // stale add did not re-admit
    expect(state.currentEpoch).toBe(1);
    expect(skipped.some((r) => r.body.case === "add")).toBe(true);
  });

  it("a self-service add (an actor adds its own second peer) is authorized", () => {
    const owner = newLocal();
    const member = newLocal();
    const tk = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, tk, "");
    log.appendAdd(owner.actor, peerPub(member), tk, 0); // owner admits member's first peer
    // The member self-signs adding their own second peer — no owner round-trip.
    const memberSecond: LocalPeer = {
      actor: member.actor,
      peer: generatePeerKeypair(),
      peerId: newPeerId(),
    };
    log.appendAdd(member.actor, peerPub(memberSecond), tk, 0);

    const { state } = log.deriveState();
    expect(state.peers.has(member.peerId)).toBe(true);
    expect(state.peers.has(memberSecond.peerId)).toBe(true);
    expect(state.peers.get(memberSecond.peerId)?.owningActorId).toBe(member.actor.actorId);
  });

  it("a self-service add by an actor that owns no peer is rejected", () => {
    const owner = newLocal();
    const member = newLocal(); // never added — owns no peer yet
    const tk = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, tk, "");
    // member tries to self-add before the owner has admitted any peer of theirs → rejected.
    log.appendAdd(member.actor, peerPub(member), tk, 0);

    const { state, skipped } = log.deriveState();
    expect(state.peers.has(member.peerId)).toBe(false);
    expect(skipped.some((r) => r.body.case === "add")).toBe(true);
  });
});

describe("membership log — peer-key crypto invariants", () => {
  it("the peer encPub is an independent random X25519 key; unwrap uses the peer private scalar", () => {
    const owner = newLocal();
    const member = newLocal();
    const tk = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, tk, "");
    log.appendAdd(owner.actor, peerPub(member), tk, 0);
    const { state } = log.deriveState();

    const d = state.peers.get(member.peerId);
    if (!d) {
      throw new Error("member peer missing");
    }
    // The peer key is X25519 and is NOT the actor's Ed25519 key (independent random key).
    expect(Buffer.from(d.peerEncPub).equals(Buffer.from(member.actor.publicKey))).toBe(false);
    expect(eq(unwrapKey(member.peer.privateKey, d.wrappedTransit), tk)).toBe(true);
  });

  it("mnemonic re-derives the same ACTOR (governance continuity); the peer key is per-peer random", () => {
    // The actor key is mnemonic-derived (re-derivable → governance + recovery anchor). The peer key
    // is random per-dataRoot and NOT mnemonic-derived — so a recovered actor on a new peer gets a
    // NEW peer key and must be re-admitted (design §13). This is the point of per-peer revocation.
    const mnemonic = "test test test test test test test test test test test junk";
    const ownerA = deriveActorKeypairFromMnemonic(mnemonic);
    const ownerB = deriveActorKeypairFromMnemonic(mnemonic);
    expect(ownerB.actorId).toBe(ownerA.actorId); // actor identity is mnemonic-recoverable
    // ...but two peers of that actor have independent random peer keys:
    const devA = generatePeerKeypair();
    const devB = generatePeerKeypair();
    expect(Buffer.from(devA.publicKey).equals(Buffer.from(devB.publicKey))).toBe(false);
  });
});

describe("membership log — replay robustness + edge characterization", () => {
  it("a revoked peer's last-known transit key cannot open new-epoch content (encPrev is one-way)", () => {
    const owner = newLocal();
    const member = newLocal();
    const k0 = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, k0, "");
    log.appendAdd(owner.actor, peerPub(member), k0, 0);
    const k1 = newTransitKey();
    log.appendRotate(owner.actor, [peerPub(owner)], k1, k0, 1); // member revoked
    const { state } = log.deriveState();
    // New-epoch content is sealed under k1; the member only ever held k0. encPrev = AEAD(k1, k0) is
    // one-way: k0 cannot recover k1, so the revoked peer can't read anything sealed after the rotate.
    const newContent = aeadEncrypt(k1, enc("post-revoke secret"));
    expect(() => aeadDecrypt(k0, newContent)).toThrow();
    expect(() => log.unwrapCurrentTransitKey(state, member)).toThrow();
  });

  it("a rotate that omits the owner is rejected (the owner must keep ≥1 peer)", () => {
    const owner = newLocal();
    const member = newLocal();
    const k0 = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, k0, "");
    log.appendAdd(owner.actor, peerPub(member), k0, 0);
    // The owner cannot rotate away every owner peer — build-time invariant.
    expect(() => log.appendRotate(owner.actor, [peerPub(member)], k0, k0, 1)).toThrow();
  });

  it("re-importing the same snapshot is idempotent (no error, no membership change)", async () => {
    const owner = newLocal();
    const member = newLocal();
    const tk = newTransitKey();
    const a = newLog();
    a.appendRoot(owner, tk, "");
    a.appendAdd(owner.actor, peerPub(member), tk, 0);
    const snap = await a.metaDoc.exportSnapshot();
    const b = newLog();
    await b.metaDoc.importUpdate(snap);
    const before = [...b.deriveState().state.peers.keys()].sort();
    await b.metaDoc.importUpdate(snap); // again — must not throw or duplicate
    const after = [...b.deriveState().state.peers.keys()].sort();
    expect(after).toEqual(before);
  });

  it("a malformed entry in the list is skipped, not fatal (CRDT-skip contract)", () => {
    const owner = newLocal();
    const tk = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, tk, "");
    // A bad replica could push anything; inject garbage bytes that protobuf can't decode.
    log.metaDoc.appendRecord(Buffer.from("!!!not valid protobuf!!!"));
    log.metaDoc.commit();
    const { state } = log.deriveState(); // must not throw
    expect(state.owner).toBe(owner.actor.actorId); // the valid root still applied; the garbage was skipped
  });
});

describe("membership log — CRDT convergence across merge orders", () => {
  it("a rotate that lists a peer not yet in state admits it; both add+rotate orders converge", () => {
    // Concurrent add(X,epoch=0) + rotate([owner,X],epoch=1). The rotate's wrapped set IS the
    // owner-signed roster, so a peerId the owner lists is admitted even if the add hasn't landed on
    // this replica yet. Both CRDT merge orders must converge to X admitted at epoch 1.
    const owner = newLocal();
    const x = newLocal();
    const k0 = newTransitKey();
    const k1 = newTransitKey();

    // Order 1: root → add → rotate (add applies at epoch 0; rotate re-keys X to epoch 1).
    const logA = newLog();
    logA.appendRoot(owner, k0, "");
    logA.appendAdd(owner.actor, peerPub(x), k0, 0);
    logA.appendRotate(owner.actor, [peerPub(owner), peerPub(x)], k1, k0, 1);

    // Order 2: root → rotate → add (rotate admits X from its roster; the add is then staleAdd-skipped).
    const logB = newLog();
    logB.appendRoot(owner, k0, "");
    logB.appendRotate(owner.actor, [peerPub(owner), peerPub(x)], k1, k0, 1);
    logB.appendAdd(owner.actor, peerPub(x), k0, 0);

    const sa = logA.deriveState().state;
    const sb = logB.deriveState().state;
    expect(sa.peers.has(x.peerId)).toBe(true);
    expect(sb.peers.has(x.peerId)).toBe(true);
    expect(sa.currentEpoch).toBe(1);
    expect(sb.currentEpoch).toBe(1);
    expect([...sa.peers.keys()].sort()).toEqual([...sb.peers.keys()].sort());
    // X unwraps the current (epoch-1) transit in both orders.
    expect(eq(logA.unwrapCurrentTransitKey(sa, x), k1)).toBe(true);
    expect(eq(logB.unwrapCurrentTransitKey(sb, x), k1)).toBe(true);
  });
});

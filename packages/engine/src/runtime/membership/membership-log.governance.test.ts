import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateActorKeypair, generatePeerKeypair } from "../../crypto/index.js";
import { MembershipLog, MEMBERSHIP_DOC_ID, type LocalPeer } from "./membership-log.js";
import type { PeerPublicKeys } from "../../domain/membership/model.js";
import { LoroMetaDoc } from "../../core/store/meta-doc.js";

/** Construct a MembershipLog backed by a fresh LoroMetaDoc (the production backing). */
const newLog = (persistence?: ConstructorParameters<typeof MembershipLog>[1]): MembershipLog =>
  new MembershipLog(new LoroMetaDoc(MEMBERSHIP_DOC_ID), persistence);

const newTransitKey = (): Uint8Array => randomBytes(32);
let counter = 1;
const newPeerId = (): string => String(counter++);

const newLocal = (): LocalPeer => ({
  actor: generateActorKeypair(),
  peer: generatePeerKeypair(),
  peerId: newPeerId(),
});

/** PeerPublicKeys for `local`'s OWN peer (peerId + encPub are local's). For `addMember`. */
const ownPeerPub = (local: LocalPeer, peerName = ""): PeerPublicKeys => ({
  peerId: local.peerId,
  owningActorId: local.actor.actorId,
  peerEncPub: local.peer.publicKey,
  peerName,
});

/** A fresh peer (new peerId + X25519) attributed to `local`'s actor — the actor's FURTHER peer. For
 *  `addSelfPeer` (the new peer's private key is irrelevant; the local admitted peer unwraps transit). */
const furtherPeer = (local: LocalPeer, peerName = ""): PeerPublicKeys => ({
  peerId: newPeerId(),
  owningActorId: local.actor.actorId,
  peerEncPub: generatePeerKeypair().publicKey,
  peerName,
});

/** Bootstrap a workspace: owner root + one admitted member. */
const boot = () => {
  const owner = newLocal();
  const member = newLocal();
  const log = newLog();
  log.appendRoot(owner, newTransitKey(), "owner-peer");
  log.addMember(owner, ownPeerPub(member, "member-peer"));
  return { owner, member, log };
};

describe("revokePeer", () => {
  it("drops the target, keeps the owner, advances the epoch", () => {
    const { owner, member, log } = boot();
    log.revokePeer(owner, member.peerId);
    const { state } = log.deriveState();
    expect([...state.peers.keys()]).toEqual([owner.peerId]);
    expect(state.currentEpoch).toBe(1);
  });

  it("refuses a non-owner caller", () => {
    const { member, owner, log } = boot();
    expect(() => log.revokePeer(member, owner.peerId)).toThrow(/only the owner can re-key/);
  });

  it("refuses to drop the owner's last peer (would brick governance)", () => {
    const { owner, log } = boot();
    expect(() => log.revokePeer(owner, owner.peerId)).toThrow(
      /cannot drop every peer of the owner/,
    );
  });

  it("throws on an unknown peerId", () => {
    const { owner, log } = boot();
    expect(() => log.revokePeer(owner, "bogus")).toThrow(/peer not admitted/);
  });
});

describe("revokeActor", () => {
  it("drops every peer of the actor (self-added further peers included)", () => {
    const { owner, member, log } = boot();
    log.addSelfPeer(member, furtherPeer(member, "member-laptop"));
    expect(log.deriveState().state.peers.size).toBe(3);

    log.revokeActor(owner, member.actor.actorId);
    expect([...log.deriveState().state.peers.keys()]).toEqual([owner.peerId]);
  });

  it("refuses an actor with no admitted peers", () => {
    const { owner, log } = boot();
    expect(() => log.revokeActor(owner, "deadbeef")).toThrow(/actor has no admitted peers/);
  });

  it("refuses to revoke the owner's own actorId (clear governance error)", () => {
    const { owner, log } = boot();
    expect(() => log.revokeActor(owner, owner.actor.actorId)).toThrow(
      /cannot drop every peer of the owner/,
    );
  });
});

describe("rotateTransit", () => {
  it("keeps the roster, advances the epoch, re-wraps each peer's transit", () => {
    const { owner, member, log } = boot();
    const before = log.deriveState().state.peers.get(owner.peerId)?.wrappedTransit;
    log.rotateTransit(owner);
    const { state } = log.deriveState();
    expect([...state.peers.keys()].sort()).toEqual([member.peerId, owner.peerId].sort());
    expect(state.currentEpoch).toBe(1);
    expect(state.peers.get(owner.peerId)?.wrappedTransit).not.toEqual(before);
  });

  it("refuses a non-owner caller", () => {
    const { member, log } = boot();
    expect(() => log.rotateTransit(member)).toThrow(/only the owner can re-key/);
  });
});

describe("addSelfPeer", () => {
  it("admits the actor's own further peer (signer == owningActor)", () => {
    const { member, log } = boot();
    const second = furtherPeer(member, "member-laptop");
    log.addSelfPeer(member, second);
    expect([...log.deriveState().state.peers.keys()]).toContain(second.peerId);
  });

  it("refuses a peer owned by a different actor", () => {
    const { member, log } = boot();
    const stranger = newLocal();
    expect(() => log.addSelfPeer(member, ownPeerPub(stranger))).toThrow(
      /owned by the calling actor/,
    );
  });

  it("refuses when the local peer isn't admitted (can't unwrap transit)", () => {
    const owner = newLocal();
    const outsider = newLocal();
    const log = newLog();
    log.appendRoot(owner, newTransitKey(), "owner-peer");
    expect(() => log.addSelfPeer(outsider, furtherPeer(outsider))).toThrow(/peer not admitted/);
  });
});

describe("transferOwnership", () => {
  it("moves governance to an existing member actor", () => {
    const { owner, member, log } = boot();
    log.transferOwnership(owner, member.actor.actorId);
    expect(log.deriveState().state.owner).toBe(member.actor.actorId);
  });

  it("refuses a non-owner caller", () => {
    const { member, log } = boot();
    expect(() => log.transferOwnership(member, "some-actor")).toThrow(
      /only the owner can transfer/,
    );
  });

  it("refuses a transfer to a non-member (clear error, not a silent skip)", () => {
    const { owner, log } = boot();
    expect(() => log.transferOwnership(owner, generateActorKeypair().actorId)).toThrow(
      /target is not a member/,
    );
  });

  it("refuses a transfer to the current owner", () => {
    const { owner, log } = boot();
    expect(() => log.transferOwnership(owner, owner.actor.actorId)).toThrow(/already the owner/);
  });

  it("refuses an empty target actor", () => {
    const { owner, log } = boot();
    expect(() => log.transferOwnership(owner, "")).toThrow(/target actor is empty/);
  });
});

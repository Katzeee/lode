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

let peerCounter = 1;
const newPeerId = (): string => String(peerCounter++);

const newLocal = (): LocalPeer => ({
  actor: generateActorKeypair(),
  peer: generatePeerKeypair(),
  peerId: newPeerId(),
});

/** PeerPublicKeys carrying a peerName (the shared helper elsewhere defaults peerName to ""). */
const namedPeer = (local: LocalPeer, peerName: string): PeerPublicKeys => ({
  peerId: local.peerId,
  owningActorId: local.actor.actorId,
  peerEncPub: local.peer.publicKey,
  peerName,
});

describe("membership log — peer_name rides on the record through replay", () => {
  it("root + add carry peer_name into deriveState", () => {
    const owner = newLocal();
    const member = newLocal();
    const k0 = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, k0, "owner-laptop");
    log.appendAdd(owner.actor, namedPeer(member, "member-phone"), k0, 0);

    const { state } = log.deriveState();
    expect(state.peers.get(owner.peerId)?.peerName).toBe("owner-laptop");
    expect(state.peers.get(member.peerId)?.peerName).toBe("member-phone");
  });

  it("rotate preserves a known peer's name (rotate never renames) and carries a novel peer's name", () => {
    const owner = newLocal();
    const member = newLocal();
    const novel = newLocal();
    const k0 = newTransitKey();
    const k1 = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, k0, "owner-laptop");
    log.appendAdd(owner.actor, namedPeer(member, "member-phone"), k0, 0);

    // Re-key keeping owner + member (names already set) AND admitting `novel` via the roster.
    // For known peers the wrapped peerName is ignored (rotate is a re-key, not a rename); for the
    // novel peer the wrapped peerName applies (the owner attests it by wrapping transit to it).
    log.appendRotate(
      owner.actor,
      [
        namedPeer(owner, "should-not-rename"),
        namedPeer(member, "should-not-rename"),
        namedPeer(novel, "novel-tab"),
      ],
      k1,
      k0,
      1,
    );

    const { state } = log.deriveState();
    expect(state.peers.get(owner.peerId)?.peerName).toBe("owner-laptop");
    expect(state.peers.get(member.peerId)?.peerName).toBe("member-phone");
    expect(state.peers.get(novel.peerId)?.peerName).toBe("novel-tab");
    expect(state.currentEpoch).toBe(1);
  });
});

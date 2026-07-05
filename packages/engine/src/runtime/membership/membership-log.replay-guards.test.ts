import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  aeadEncrypt,
  generateActorKeypair,
  generatePeerKeypair,
  signWithActor,
  wrapKey,
  type ActorKeypair,
} from "../../utils/crypto/index.js";
import { create, toBinary } from "@bufbuild/protobuf";
import {
  PeerWrapSchema,
  MembershipRecordSchema,
  RootRecordSchema,
  RotateRecordSchema,
  type MembershipRecord,
} from "@lode/protocol/proto";
import { bodyBytes } from "./membership-replay.js";
import { MembershipLog, type PeerPublicKeys, type LocalPeer } from "./membership-log.js";

// Authority-independent replay guards (the invariants that hold regardless of who signed): exercised
// by appending a signed record with an ARBITRARY body, bypassing the appendRotate/appendTransfer
// builders' self-consistency guards. Split from membership-log.replay.test.ts to stay under the line cap.

const newTransitKey = (): Uint8Array => randomBytes(32);
const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
let peerCounter = 1;
const newPeerId = (): string => String(peerCounter++);
const newLocal = (): LocalPeer => ({
  actor: generateActorKeypair(),
  peer: generatePeerKeypair(),
  peerId: newPeerId(),
});
const peerPub = (local: LocalPeer): PeerPublicKeys => ({
  peerId: local.peerId,
  owningActorId: local.actor.actorId,
  peerEncPub: local.peer.publicKey,
  peerName: "",
});

/** Append a signed record with an arbitrary body — bypass the builders' guards to probe replay directly. */
function appendRawSigned(
  log: MembershipLog,
  signer: ActorKeypair,
  body: MembershipRecord["body"],
): void {
  const sig = signWithActor(signer.privateKey, bodyBytes(body));
  const rec = create(MembershipRecordSchema, { signer: signer.actorId, sig, body });
  log.doc
    .getList("membership_log")
    .push(Buffer.from(toBinary(MembershipRecordSchema, rec)).toString("base64"));
  log.doc.commit();
}

describe("membership log — replay-side invariants (authority-independent, any-sync-aligned)", () => {
  it("a signed rotate that drops every owner peer is skipped (replay guard against governance brick)", () => {
    const owner = newLocal();
    const member = newLocal();
    const k0 = newTransitKey();
    const k1 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, k0, "");
    log.appendAdd(owner.actor, peerPub(member), k0, 0);
    // A rotate, signed by the owner, that lists only the member's peer (drops every owner peer).
    // appendRotate refuses this at build time; bypass it to probe the REPLAY invariant.
    appendRawSigned(log, owner.actor, {
      case: "rotate",
      value: create(RotateRecordSchema, {
        epoch: 1,
        wrapped: [
          create(PeerWrapSchema, {
            peerId: member.peerId,
            owningActorId: member.actor.actorId,
            peerEncPub: member.peer.publicKey,
            wrappedTransit: wrapKey(member.peer.publicKey, k1),
          }),
        ],
        encPrev: aeadEncrypt(k1, k0),
      }),
    });

    const { state, skipped } = log.deriveState();
    expect(state.owner).toBe(owner.actor.actorId); // owner still governs
    expect(state.peers.has(owner.peerId)).toBe(true); // owner's peer NOT revoked
    expect(state.peers.has(member.peerId)).toBe(true); // member still present (epoch 0)
    expect(state.currentEpoch).toBe(0); // rotate skipped → epoch unchanged from root
    expect(eq(log.unwrapCurrentTransitKey(state, owner), k0)).toBe(true); // k1 never applied
    expect(skipped.some((r) => r.body.case === "rotate")).toBe(true);
  });

  it("a transfer to the current owner (self-transfer) is skipped", () => {
    const owner = newLocal();
    const tk = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, tk, "");
    log.appendTransfer(owner.actor, owner.actor.actorId); // owner → owner: a signed no-op

    const { state, skipped } = log.deriveState();
    expect(state.owner).toBe(owner.actor.actorId);
    expect(skipped.some((r) => r.body.case === "transfer")).toBe(true);
  });

  it("a root whose declared owner ≠ signer is skipped", () => {
    const owner = newLocal();
    const tk = newTransitKey();
    const log = new MembershipLog();
    // A root body carrying a forged owner label, signed by the real owner key. The owner self-signs,
    // so the declared owner must equal the signer (else the label diverges from the signing key).
    appendRawSigned(log, owner.actor, {
      case: "root",
      value: create(RootRecordSchema, {
        owner: "bogus-actor-id",
        ownerPeerEncPub: owner.peer.publicKey,
        ownerPeerId: owner.peerId,
        wrappedTransit: wrapKey(owner.peer.publicKey, tk),
        epoch: 0,
      }),
    });

    const { state, skipped } = log.deriveState();
    expect(state.owner).toBe(""); // root rejected → no owner installed
    expect(state.peers.size).toBe(0);
    expect(skipped.some((r) => r.body.case === "root")).toBe(true);
  });
});

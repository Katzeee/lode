import { randomBytes } from "node:crypto";
import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  aeadDecrypt,
  aeadEncrypt,
  generateActorKeypair,
  generatePeerKeypair,
  signWithActor,
  type ActorKeypair,
} from "../../utils/crypto/index.js";
import {
  AddRecordSchema,
  MembershipRecordSchema,
  type MembershipRecord,
} from "@lode/protocol/proto";
import { MembershipLog, MEMBERSHIP_DOC_ID, type LocalPeer } from "./membership-log.js";
import { LoroMetaDoc } from "../../core/meta-doc.js";

/** Construct a MembershipLog backed by a fresh LoroMetaDoc (the production backing). */
const newLog = (persistence?: ConstructorParameters<typeof MembershipLog>[1]): MembershipLog =>
  new MembershipLog(new LoroMetaDoc(MEMBERSHIP_DOC_ID), persistence);

const newTransitKey = (): Uint8Array => randomBytes(32);
const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

let peerCounter = 1;
const newPeerId = (): string => String(peerCounter++);
const newLocal = (): LocalPeer => ({
  actor: generateActorKeypair(),
  peer: generatePeerKeypair(),
  peerId: newPeerId(),
});
const peerPub = (local: LocalPeer) => ({
  peerId: local.peerId,
  owningActorId: local.actor.actorId,
  peerEncPub: local.peer.publicKey,
  peerName: "",
});

describe("membership log — lifecycle", () => {
  it("root + add: owner and member peers both unwrap the transit key and decrypt transit content", () => {
    const owner = newLocal();
    const member = newLocal();
    const tk = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, tk, "");
    log.appendAdd(owner.actor, peerPub(member), tk, 0);

    const { state, skipped } = log.deriveState();
    expect(skipped).toHaveLength(0);
    expect(state.owner).toBe(owner.actor.actorId);
    expect([...state.peers.keys()].sort()).toEqual([member.peerId, owner.peerId].sort());

    expect(eq(log.unwrapCurrentTransitKey(state, owner), tk)).toBe(true);
    expect(eq(log.unwrapCurrentTransitKey(state, member), tk)).toBe(true);

    // The transit key decrypts transit content (a relay would see only this ciphertext).
    const cipher = aeadEncrypt(tk, enc("in-transit payload"));
    expect(
      eq(
        aeadDecrypt(log.unwrapCurrentTransitKey(state, member), cipher),
        enc("in-transit payload"),
      ),
    ).toBe(true);
  });

  it("rotate omits a peer → it is revoked and cannot read the new epoch (forward secrecy)", () => {
    const owner = newLocal();
    const member = newLocal();
    const k0 = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, k0, "");
    log.appendAdd(owner.actor, peerPub(member), k0, 0);
    const k1 = newTransitKey();
    // Owner re-keys wrapping only their own peer → member's peer omitted → revoked.
    log.appendRotate(owner.actor, [peerPub(owner)], k1, k0, 1);

    const { state } = log.deriveState();
    expect(state.peers.has(member.peerId)).toBe(false);
    expect(state.currentEpoch).toBe(1);
    expect(eq(log.unwrapCurrentTransitKey(state, owner), k1)).toBe(true);
    expect(() => log.unwrapCurrentTransitKey(state, member)).toThrow();
  });
});

describe("membership log — owner-only governance", () => {
  it("transfer: the new owner can govern; the old owner (now a member) cannot add for another actor", () => {
    const owner = newLocal();
    const successor = newLocal();
    const newMember = newLocal();
    const tk = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, tk, "");
    log.appendAdd(owner.actor, peerPub(successor), tk, 0);

    log.appendTransfer(owner.actor, successor.actor.actorId);
    expect(log.deriveState().state.owner).toBe(successor.actor.actorId);

    // The new owner adds a peer — applies.
    log.appendAdd(successor.actor, peerPub(newMember), tk, 0);
    expect(log.deriveState().state.peers.has(newMember.peerId)).toBe(true);

    // The OLD owner (now a member) tries to add a peer for a different actor — skipped (not owner,
    // and not the owning actor self-adding).
    const intruder = newLocal();
    log.appendAdd(owner.actor, peerPub(intruder), tk, 0);
    const { state, skipped } = log.deriveState();
    expect(state.peers.has(intruder.peerId)).toBe(false);
    expect(skipped.some((r) => r.body.case === "add")).toBe(true);
  });

  it("a member can self-add their own peer, but cannot add for another actor or rotate", () => {
    const owner = newLocal();
    const member = newLocal();
    const intruder = newLocal();
    const k0 = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, k0, "");
    log.appendAdd(owner.actor, peerPub(member), k0, 0);
    // Member self-adds their own SECOND peer — authorized (self-service, §13).
    const memberSecond: LocalPeer = {
      actor: member.actor,
      peer: generatePeerKeypair(),
      peerId: newPeerId(),
    };
    log.appendAdd(member.actor, peerPub(memberSecond), k0, 0);
    expect(log.deriveState().state.peers.has(memberSecond.peerId)).toBe(true);

    // Member forges an add for a DIFFERENT actor (intruder) — skipped.
    log.appendAdd(member.actor, peerPub(intruder), k0, 0);
    // Member forges a rotate — skipped (owner-only).
    log.appendRotate(member.actor, [peerPub(member)], newTransitKey(), k0, 1);

    const { state, skipped } = log.deriveState();
    expect(state.peers.has(intruder.peerId)).toBe(false);
    expect(state.currentEpoch).toBe(0); // forged rotate rejected
    expect(skipped).toHaveLength(2);
  });

  it("a tampered signature is skipped, and an unknown signer (owns no peer) is skipped", () => {
    const owner = newLocal();
    const member = newLocal();
    const k0 = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, k0, "");
    log.appendAdd(owner.actor, peerPub(member), k0, 0);

    // Rebuild a log with the add record's signature zeroed.
    const tampered = newLog();
    for (const r of log.records()) {
      const mutated: MembershipRecord =
        r.body.case === "add" ? { ...r, sig: new Uint8Array(64) } : r;
      tampered.metaDoc.appendRecord(toBinary(MembershipRecordSchema, mutated));
    }
    tampered.metaDoc.commit();
    const t = tampered.deriveState();
    expect(t.state.peers.has(member.peerId)).toBe(false);
    expect(t.skipped.length).toBeGreaterThan(0);

    // An unknown signer (owns no peer anywhere) self-signs an add for themselves → skipped: the
    // self-service rule requires the signer to already own ≥1 admitted peer.
    const stranger: ActorKeypair = generateActorKeypair();
    const strangerLog = newLog();
    strangerLog.appendRoot(owner, k0, "");
    const body = create(AddRecordSchema, {
      owningActor: stranger.actorId,
      peerEncPub: generatePeerKeypair().publicKey,
      peerId: newPeerId(),
      wrappedTransit: new Uint8Array(0),
      epoch: 0,
    });
    const forged = create(MembershipRecordSchema, {
      signer: stranger.actorId,
      sig: signWithActor(stranger.privateKey, toBinary(AddRecordSchema, body)),
      body: { case: "add", value: body },
    });
    strangerLog.metaDoc.appendRecord(toBinary(MembershipRecordSchema, forged));
    strangerLog.metaDoc.commit();

    const { state, skipped } = strangerLog.deriveState();
    expect([...state.peers.values()].some((d) => d.owningActorId === stranger.actorId)).toBe(false);
    expect(skipped.some((r) => r.body.case === "add")).toBe(true);
  });
});

describe("membership log — addMember (owner-guarded composition)", () => {
  it("the owner adds a peer: it joins at the current epoch and unwraps the transit key", () => {
    const owner = newLocal();
    const member = newLocal();
    const tk = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, tk, "");

    log.addMember(owner, peerPub(member));

    const { state, skipped } = log.deriveState();
    expect(skipped).toHaveLength(0);
    expect(state.peers.has(member.peerId)).toBe(true);
    const d = state.peers.get(member.peerId)!;
    expect(eq(d.peerEncPub, member.peer.publicKey)).toBe(true);
    expect(d.owningActorId).toBe(member.actor.actorId);
    expect(d.epoch).toBe(state.currentEpoch);
    // The wrapped transit key decrypts — addMember wrapped the current key to the peer.
    expect(eq(log.unwrapCurrentTransitKey(state, member), tk)).toBe(true);
  });

  it("a non-owner is refused and the log is unchanged", () => {
    const owner = newLocal();
    const member = newLocal();
    const outsider = newLocal();
    const tk = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, tk, "");
    log.appendAdd(owner.actor, peerPub(member), tk, 0);
    const before = log.records().length;

    expect(() => log.addMember(outsider, peerPub(newLocal()))).toThrow(
      "addMember: only the owner can add members",
    );

    expect(log.records().length).toBe(before);
    const { state } = log.deriveState();
    expect(state.owner).toBe(owner.actor.actorId);
  });

  it("refuses on a workspace with no owner root yet (e.g. an unrooted log)", () => {
    const log = newLog();
    const owner = newLocal();
    expect(() => log.addMember(owner, peerPub(newLocal()))).toThrow(
      "addMember: workspace has no owner root",
    );
    expect(log.records()).toHaveLength(0);
  });
});

describe("membership log — recovery (re-add → current transit key)", () => {
  it("a re-added peer regains the current transit key", () => {
    const owner = newLocal();
    const member = newLocal();
    const k0 = newTransitKey();
    const k1 = newTransitKey();
    const k2 = newTransitKey();
    const log = newLog();
    log.appendRoot(owner, k0, "");
    log.appendAdd(owner.actor, peerPub(member), k0, 0);
    log.appendRotate(owner.actor, [peerPub(owner), peerPub(member)], k1, k0, 1);
    // Member's peer loses access: revoked (omitted from a rotate), key rotated beyond them.
    log.appendRotate(owner.actor, [peerPub(owner)], k2, k1, 2);
    // Owner re-adds the SAME peer at the current epoch with the current key.
    log.appendAdd(owner.actor, peerPub(member), k2, 2);

    const { state } = log.deriveState();
    expect(state.peers.has(member.peerId)).toBe(true);
    expect(eq(log.unwrapCurrentTransitKey(state, member), k2)).toBe(true);
  });
});

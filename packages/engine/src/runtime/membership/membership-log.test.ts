import { randomBytes } from "node:crypto";
import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { aeadDecrypt, aeadEncrypt } from "../../utils/crypto/aes.js";
import { actorEncryptionPublic } from "../../identity/actor-encryption.js";
import {
  generateActorKeypair,
  signWithActor,
  type ActorKeypair,
} from "../../identity/actor-key.js";
import {
  AddRecordSchema,
  MembershipRecordSchema,
  type MembershipRecord,
} from "@lode/protocol/proto";
import { MembershipLog, type Survivor } from "./membership-log.js";

const newTransitKey = (): Uint8Array => randomBytes(32);
const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A rotate survivor spec from a member keypair (the owner knows each member's public keys). */
const survivor = (m: ActorKeypair): Survivor => ({
  actorId: m.actorId,
  signPub: m.publicKey,
  encPub: actorEncryptionPublic(m.publicKey),
});

describe("membership log — lifecycle", () => {
  it("root + add: owner and member both unwrap the transit key and decrypt transit content", () => {
    const owner = generateActorKeypair();
    const member = generateActorKeypair();
    const tk = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, tk);
    log.appendAdd(owner, member, tk, 0);

    const { state, skipped } = log.deriveState();
    expect(skipped).toHaveLength(0);
    expect(state.owner).toBe(owner.actorId);
    expect([...state.members.keys()].sort()).toEqual([member.actorId, owner.actorId].sort());

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

  it("rotate omits a member → they are revoked and cannot read the new epoch (forward secrecy)", () => {
    const owner = generateActorKeypair();
    const member = generateActorKeypair();
    const k0 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, k0);
    log.appendAdd(owner, member, k0, 0);
    const k1 = newTransitKey();
    // Owner re-keys wrapping only themselves → member omitted → revoked (atomic removeAndRotate).
    log.appendRotate(owner, [survivor(owner)], k1, k0, 1);

    const { state } = log.deriveState();
    expect(state.members.has(member.actorId)).toBe(false);
    expect(state.currentEpoch).toBe(1);
    expect(eq(log.unwrapCurrentTransitKey(state, owner), k1)).toBe(true);
    expect(() => log.unwrapCurrentTransitKey(state, member)).toThrow();
  });

  it("re-key chain: a current member walks back to decrypt every prior epoch", () => {
    const owner = generateActorKeypair();
    const k0 = newTransitKey();
    const k1 = newTransitKey();
    const k2 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, k0);
    log.appendRotate(owner, [survivor(owner)], k1, k0, 1);
    log.appendRotate(owner, [survivor(owner)], k2, k1, 2);

    const { state } = log.deriveState();
    expect(eq(log.unwrapCurrentTransitKey(state, owner), k2)).toBe(true);
    expect(eq(log.walkHistoryTransitKey(state, owner, 1), k1)).toBe(true);
    expect(eq(log.walkHistoryTransitKey(state, owner, 0), k0)).toBe(true);
  });
});

describe("membership log — owner-only governance", () => {
  it("transfer: the new owner can govern; the old owner (now a member) cannot", () => {
    const owner = generateActorKeypair();
    const successor = generateActorKeypair();
    const newMember = generateActorKeypair();
    const tk = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, tk);
    log.appendAdd(owner, successor, tk, 0);

    log.appendTransfer(owner, successor.actorId);
    expect(log.deriveState().state.owner).toBe(successor.actorId);

    // The new owner adds a member — applies.
    log.appendAdd(successor, newMember, tk, 0);
    expect(log.deriveState().state.members.has(newMember.actorId)).toBe(true);

    // The OLD owner (now a member) tries to add someone — skipped (not the owner).
    const intruder = generateActorKeypair();
    log.appendAdd(owner, intruder, tk, 0);
    const { state, skipped } = log.deriveState();
    expect(state.members.has(intruder.actorId)).toBe(false);
    expect(skipped.some((r) => r.body.case === "add")).toBe(true);
  });

  it("a member (non-owner) cannot rotate or add — the records are skipped", () => {
    const owner = generateActorKeypair();
    const member = generateActorKeypair();
    const intruder = generateActorKeypair();
    const k0 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, k0);
    log.appendAdd(owner, member, k0, 0);
    // Member forges an add and a rotate (signing as themselves, not the owner).
    log.appendAdd(member, intruder, k0, 0);
    log.appendRotate(member, [survivor(member)], newTransitKey(), k0, 1);

    const { state, skipped } = log.deriveState();
    expect(state.members.has(intruder.actorId)).toBe(false);
    expect(state.currentEpoch).toBe(0); // forged rotate rejected
    expect(skipped).toHaveLength(2);
  });

  it("a tampered signature is skipped, and an unknown signer (not a member) is skipped", () => {
    const owner = generateActorKeypair();
    const member = generateActorKeypair();
    const k0 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, k0);
    log.appendAdd(owner, member, k0, 0);

    // Rebuild a log with the add record's signature zeroed.
    const tampered = new MembershipLog();
    for (const r of log.records()) {
      const mutated: MembershipRecord =
        r.body.case === "add" ? { ...r, sig: new Uint8Array(64) } : r;
      tampered.doc
        .getList("membership_log")
        .push(Buffer.from(toBinary(MembershipRecordSchema, mutated)).toString("base64"));
    }
    tampered.doc.commit();
    const t = tampered.deriveState();
    expect(t.state.members.has(member.actorId)).toBe(false);
    expect(t.skipped.length).toBeGreaterThan(0);

    // An unknown signer (not in the membership at all) self-signs an add → skipped (no signPub).
    const stranger = generateActorKeypair();
    const strangerLog = new MembershipLog();
    strangerLog.appendRoot(owner, k0);
    const body = create(AddRecordSchema, {
      actor: stranger.actorId,
      signPub: stranger.publicKey,
      encPub: actorEncryptionPublic(stranger.publicKey),
      wrappedTransit: new Uint8Array(0),
      epoch: 0,
    });
    const forged = create(MembershipRecordSchema, {
      signer: stranger.actorId,
      sig: signWithActor(stranger.privateKey, toBinary(AddRecordSchema, body)),
      body: { case: "add", value: body },
    });
    strangerLog.doc
      .getList("membership_log")
      .push(Buffer.from(toBinary(MembershipRecordSchema, forged)).toString("base64"));
    strangerLog.doc.commit();

    const { state, skipped } = strangerLog.deriveState();
    expect(state.members.has(stranger.actorId)).toBe(false);
    expect(skipped.some((r) => r.body.case === "add")).toBe(true);
  });
});

describe("membership log — recovery (re-add → current transit key + full history)", () => {
  it("a re-added member regains the current transit key and walks the chain to all history", () => {
    const owner = generateActorKeypair();
    const member = generateActorKeypair();
    const k0 = newTransitKey();
    const k1 = newTransitKey();
    const k2 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, k0);
    log.appendAdd(owner, member, k0, 0);
    log.appendRotate(owner, [survivor(owner), survivor(member)], k1, k0, 1);
    // Member loses access: revoked (omitted from a rotate), key rotated beyond them.
    log.appendRotate(owner, [survivor(owner)], k2, k1, 2);
    // Owner re-adds the member (same recovered actor) at the current epoch with the current key.
    log.appendAdd(owner, member, k2, 2);

    const { state } = log.deriveState();
    expect(state.members.has(member.actorId)).toBe(true);
    expect(eq(log.unwrapCurrentTransitKey(state, member), k2)).toBe(true);
    expect(eq(log.walkHistoryTransitKey(state, member, 1), k1)).toBe(true);
    expect(eq(log.walkHistoryTransitKey(state, member, 0), k0)).toBe(true);
  });
});

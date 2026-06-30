import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aeadDecrypt, aeadEncrypt } from "../../utils/crypto/aes.js";
import {
  actorEncryptionPrivate,
  actorEncryptionPublic,
  unwrapKey,
} from "../../identity/actor-encryption.js";
import { generateMnemonic } from "../../utils/crypto/bip39.js";
import {
  deriveActorKeypairFromMnemonic,
  generateActorKeypair,
  type ActorKeypair,
} from "../../identity/actor-key.js";
import { MembershipLog, type MemberPublicKeys } from "./membership-log.js";

const newTransitKey = (): Uint8Array => randomBytes(32);
const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const memberPub = (m: ActorKeypair): MemberPublicKeys => ({
  actorId: m.actorId,
  signPub: m.publicKey,
  encPub: actorEncryptionPublic(m.publicKey),
});

describe("membership log — replay rejection rules (CRDT-skip thesis)", () => {
  it("a stale rotate (epoch ≤ current) is skipped; currentEpoch is unchanged", () => {
    const owner = generateActorKeypair();
    const k0 = newTransitKey();
    const k1 = newTransitKey();
    const k0b = newTransitKey(); // would-be stale rotate key
    const log = new MembershipLog();
    log.appendRoot(owner, k0);
    log.appendRotate(owner, [memberPub(owner)], k1, k0, 1);
    // A second rotate claiming epoch 1 (not strictly ahead of current=1) → skipped.
    log.appendRotate(owner, [memberPub(owner)], k0b, k1, 1);

    const { state, skipped } = log.deriveState();
    expect(state.currentEpoch).toBe(1);
    expect(eq(log.unwrapCurrentTransitKey(state, owner), k1)).toBe(true); // stale key never applied
    expect(skipped.some((r) => r.body.case === "rotate")).toBe(true);
  });

  it("a forged transfer by a non-owner is skipped (ownership doesn't move)", () => {
    const owner = generateActorKeypair();
    const member = generateActorKeypair();
    const tk = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, tk);
    log.appendAdd(owner, memberPub(member), tk, 0);
    log.appendTransfer(member, member.actorId); // member forges ownership to themselves

    const { state, skipped } = log.deriveState();
    expect(state.owner).toBe(owner.actorId);
    expect(skipped.some((r) => r.body.case === "transfer")).toBe(true);
  });

  it("a second root (a former owner re-seizing governance) is skipped", () => {
    const owner = generateActorKeypair();
    const successor = generateActorKeypair();
    const tk = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, tk);
    log.appendAdd(owner, memberPub(successor), tk, 0);
    log.appendTransfer(owner, successor.actorId);
    log.appendRoot(owner, newTransitKey()); // old owner self-authorizes a fresh root → skipped

    const { state, skipped } = log.deriveState();
    expect(state.owner).toBe(successor.actorId);
    expect(skipped.some((r) => r.body.case === "root")).toBe(true);
  });

  it("a transfer to a non-member is skipped (can't brick governance on a stranger)", () => {
    const owner = generateActorKeypair();
    const stranger = generateActorKeypair();
    const tk = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, tk);
    log.appendTransfer(owner, stranger.actorId); // stranger was never added

    const { state, skipped } = log.deriveState();
    expect(state.owner).toBe(owner.actorId); // transfer rejected
    expect(skipped.some((r) => r.body.case === "transfer")).toBe(true);
  });

  it("rotate is re-key + revoke only: an unknown actor in the wrapped set is NOT added", () => {
    const owner = generateActorKeypair();
    const stranger = generateActorKeypair();
    const k0 = newTransitKey();
    const k1 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, k0);
    // Onboarding is add-only (design §2); a stranger listed in rotate is a no-op, not an add.
    log.appendRotate(owner, [memberPub(owner), memberPub(stranger)], k1, k0, 1);

    const { state } = log.deriveState();
    expect(state.members.has(stranger.actorId)).toBe(false);
    expect(state.currentEpoch).toBe(1);
  });
});

describe("membership log — dual-use crypto invariants + mnemonic recovery (F3b)", () => {
  it("the stored encPub is the X25519 pub, distinct from the Ed25519 signPub", () => {
    const owner = generateActorKeypair();
    const member = generateActorKeypair();
    const tk = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, tk);
    log.appendAdd(owner, memberPub(member), tk, 0);
    const { state } = log.deriveState();

    const m = state.members.get(member.actorId)!;
    expect(Buffer.from(m.encPub).equals(Buffer.from(member.publicKey))).toBe(false); // X25519 ≠ Ed25519
    // Positive control: the member unwraps via the dual-use X25519 scalar derived from its Ed25519 key.
    expect(eq(unwrapKey(actorEncryptionPrivate(member.privateKey), m.wrappedTransit), tk)).toBe(
      true,
    );
  });

  it("mnemonic recovery: a re-derived owner on a new device re-derives the same X25519 unwrap", () => {
    const mnemonic = generateMnemonic();
    const ownerA = deriveActorKeypairFromMnemonic(mnemonic);
    const k0 = newTransitKey();
    const k1 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(ownerA, k0);
    log.appendRotate(ownerA, [memberPub(ownerA)], k1, k0, 1);

    // New device: re-derive the SAME owner from the mnemonic, replay the synced log, recover transit.
    const ownerB = deriveActorKeypairFromMnemonic(mnemonic);
    expect(ownerB.actorId).toBe(ownerA.actorId);
    const recovered = new MembershipLog();
    recovered.toSyncDoc().importUpdate(log.toSyncDoc().exportSnapshot());
    const { state } = recovered.deriveState();
    expect(eq(recovered.unwrapCurrentTransitKey(state, ownerB), k1)).toBe(true);
  });
});

describe("membership log — replay robustness + edge characterization", () => {
  it("a revoked member's last-known transit key cannot open new-epoch content (encPrev is one-way)", () => {
    const owner = generateActorKeypair();
    const member = generateActorKeypair();
    const k0 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, k0);
    log.appendAdd(owner, memberPub(member), k0, 0);
    const k1 = newTransitKey();
    log.appendRotate(owner, [memberPub(owner)], k1, k0, 1); // member revoked
    const { state } = log.deriveState();
    // New-epoch content is sealed under k1; the member only ever held k0. encPrev = AEAD(k1, k0) is
    // one-way: k0 cannot recover k1, so the revoked member can't read anything sealed after the rotate.
    const newContent = aeadEncrypt(k1, enc("post-revoke secret"));
    expect(() => aeadDecrypt(k0, newContent)).toThrow();
    expect(() => log.unwrapCurrentTransitKey(state, member)).toThrow();
  });

  it("a rotate that omits the owner is rejected (the owner is always a member)", () => {
    const owner = generateActorKeypair();
    const member = generateActorKeypair();
    const k0 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, k0);
    log.appendAdd(owner, memberPub(member), k0, 0);
    // The owner cannot rotate themselves out of membership — build-time invariant.
    expect(() => log.appendRotate(owner, [memberPub(member)], k0, k0, 1)).toThrow();
  });

  it("re-importing the same snapshot is idempotent (no error, no membership change)", () => {
    const owner = generateActorKeypair();
    const member = generateActorKeypair();
    const tk = newTransitKey();
    const a = new MembershipLog();
    a.appendRoot(owner, tk);
    a.appendAdd(owner, memberPub(member), tk, 0);
    const snap = a.toSyncDoc().exportSnapshot();
    const b = new MembershipLog();
    b.toSyncDoc().importUpdate(snap);
    const before = [...b.deriveState().state.members.keys()].sort();
    b.toSyncDoc().importUpdate(snap); // again — must not throw or duplicate
    const after = [...b.deriveState().state.members.keys()].sort();
    expect(after).toEqual(before);
  });

  it("a malformed entry in the list is skipped, not fatal (CRDT-skip contract)", () => {
    const owner = generateActorKeypair();
    const tk = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, tk);
    log.doc.getList("membership_log").push("!!!not valid protobuf!!!"); // a bad replica could push anything
    log.doc.commit();
    const { state } = log.deriveState(); // must not throw
    expect(state.owner).toBe(owner.actorId); // the valid root still applied; the garbage was skipped
  });
});

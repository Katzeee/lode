import { describe, expect, it } from "vitest";
import {
  aeadDecrypt,
  aeadEncrypt,
  generateActor,
  newTransitKey,
  signEd,
  toHex,
  wrapKey,
} from "../src/membership-crypto.js";
import { MembershipLog } from "../src/membership-log.js";

const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("P7 membership log — lifecycle", () => {
  it("root + add: owner and member both unwrap the transit key and decrypt transit content", () => {
    const owner = generateActor();
    const member = generateActor();
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
    const owner = generateActor();
    const member = generateActor();
    const k0 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, k0);
    log.appendAdd(owner, member, k0, 0);
    const k1 = newTransitKey();
    // Owner re-keys wrapping only themselves → member omitted → revoked (atomic removeAndRotate).
    log.appendRotate(owner, [{ actorId: owner.actorId, encPubSpki: owner.encPubSpki }], k1, k0, 1);

    const { state } = log.deriveState();
    expect(state.members.has(member.actorId)).toBe(false);
    expect(state.currentEpoch).toBe(1);
    expect(eq(log.unwrapCurrentTransitKey(state, owner), k1)).toBe(true);
    expect(() => log.unwrapCurrentTransitKey(state, member)).toThrow();
  });

  it("re-key chain: a current member walks back to decrypt every prior epoch", () => {
    const owner = generateActor();
    const k0 = newTransitKey();
    const k1 = newTransitKey();
    const k2 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, k0);
    log.appendRotate(owner, [{ actorId: owner.actorId, encPubSpki: owner.encPubSpki }], k1, k0, 1);
    log.appendRotate(owner, [{ actorId: owner.actorId, encPubSpki: owner.encPubSpki }], k2, k1, 2);

    const { state } = log.deriveState();
    expect(eq(log.unwrapCurrentTransitKey(state, owner), k2)).toBe(true);
    expect(eq(log.walkHistoryTransitKey(state, owner, 1), k1)).toBe(true);
    expect(eq(log.walkHistoryTransitKey(state, owner, 0), k0)).toBe(true);
  });
});

describe("P7 membership log — owner-only governance", () => {
  it("transfer: the new owner can govern; the old owner (now a member) cannot", () => {
    const owner = generateActor();
    const successor = generateActor();
    const newMember = generateActor();
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
    const intruder = generateActor();
    log.appendAdd(owner, intruder, tk, 0);
    const { state, skipped } = log.deriveState();
    expect(state.members.has(intruder.actorId)).toBe(false);
    expect(skipped.some((r) => r.t === "add")).toBe(true);
  });

  it("a member (non-owner) cannot rotate or add — the records are skipped", () => {
    const owner = generateActor();
    const member = generateActor();
    const intruder = generateActor();
    const k0 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, k0);
    log.appendAdd(owner, member, k0, 0);
    // Member forges an add and a rotate (signing as themselves, not the owner).
    log.appendAdd(member, intruder, k0, 0);
    log.appendRotate(
      member,
      [{ actorId: member.actorId, encPubSpki: member.encPubSpki }],
      newTransitKey(),
      k0,
      1,
    );

    const { state, skipped } = log.deriveState();
    expect(state.members.has(intruder.actorId)).toBe(false);
    expect(state.currentEpoch).toBe(0); // forged rotate rejected
    expect(skipped.length).toBe(2);
  });

  it("a tampered signature is skipped, and an unknown signer (not a member) is skipped", () => {
    const owner = generateActor();
    const member = generateActor();
    const k0 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, k0);
    log.appendAdd(owner, member, k0, 0);

    // Rebuild a log with the add record's signature corrupted.
    const tampered = new MembershipLog();
    for (const r of log.records()) {
      const mutated = r.t === "add" ? { ...r, sig: "00".repeat(64) } : r;
      tampered.doc.getList("log").push(JSON.stringify(mutated));
    }
    tampered.doc.commit();
    const t = tampered.deriveState();
    expect(t.state.members.has(member.actorId)).toBe(false);
    expect(t.skipped.length).toBeGreaterThan(0);

    // An unknown signer (not in the membership at all) self-signs an add → skipped.
    const stranger = generateActor();
    const canonical = JSON.stringify({
      t: "add",
      actor: stranger.actorId,
      signSpki: toHex(stranger.signPubSpki),
      enc: toHex(stranger.encPubSpki),
      wrapped: toHex(wrapKey(stranger.encPubSpki, k0)),
      epoch: 0,
      signer: stranger.actorId,
    });
    const strangerAdd = JSON.parse(canonical);
    strangerAdd.sig = toHex(signEd(stranger.signPriv, new TextEncoder().encode(canonical)));
    log.doc.getList("log").push(JSON.stringify(strangerAdd));
    log.doc.commit();

    const { state, skipped } = log.deriveState();
    expect(state.members.has(stranger.actorId)).toBe(false);
    expect(skipped.some((r) => (r as { actor?: string }).actor === stranger.actorId)).toBe(true);
  });
});

describe("P7 membership log — recovery (re-add → current transit key + full history)", () => {
  it("a re-added member regains the current transit key and walks the chain to all history", () => {
    const owner = generateActor();
    const member = generateActor();
    const k0 = newTransitKey();
    const k1 = newTransitKey();
    const k2 = newTransitKey();
    const log = new MembershipLog();
    log.appendRoot(owner, k0);
    log.appendAdd(owner, member, k0, 0);
    log.appendRotate(
      owner,
      [
        { actorId: owner.actorId, encPubSpki: owner.encPubSpki },
        { actorId: member.actorId, encPubSpki: member.encPubSpki },
      ],
      k1,
      k0,
      1,
    );
    // Member loses access: revoked (omitted from a rotate), key rotated beyond them.
    log.appendRotate(owner, [{ actorId: owner.actorId, encPubSpki: owner.encPubSpki }], k2, k1, 2);
    // Owner re-adds the member (same recovered actor) at the current epoch with the current key.
    log.appendAdd(owner, member, k2, 2);

    const { state } = log.deriveState();
    expect(state.members.has(member.actorId)).toBe(true);
    expect(eq(log.unwrapCurrentTransitKey(state, member), k2)).toBe(true);
    expect(eq(log.walkHistoryTransitKey(state, member, 1), k1)).toBe(true);
    expect(eq(log.walkHistoryTransitKey(state, member, 0), k0)).toBe(true);
  });
});

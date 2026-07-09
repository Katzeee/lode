import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MembershipLog, MEMBERSHIP_DOC_ID, type LocalPeer } from "./membership-log.js";
import { generateActorKeypair, generatePeerKeypair } from "../../utils/crypto/index.js";
import { createMembershipWireSecurity } from "./membership-security.js";
import { open, seal } from "./wire-security.js";
import { LoroMetaDoc } from "../../core/store/meta-doc.js";

/** Construct a MembershipLog backed by a fresh LoroMetaDoc (the production backing). */
const newLog = (persistence?: ConstructorParameters<typeof MembershipLog>[1]): MembershipLog =>
  new MembershipLog(new LoroMetaDoc(MEMBERSHIP_DOC_ID), persistence);

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

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

describe("createMembershipWireSecurity — transit key + member set from a membership log", () => {
  it("flips isMember + installs the transit key once the log converges the peer", async () => {
    const owner = newLocal();
    const member = newLocal();
    const tk = randomBytes(32);

    // The member's log starts EMPTY — it converges the roster separately (here, by importing it).
    const log = newLog();
    const ms = createMembershipWireSecurity({ log, local: member });

    // Reads are a lazy projection of the log — no refresh step. Empty log → not a member.
    expect(ms.isMember()).toBe(false); // peer not admitted yet → host skips the sealed content round
    expect(ms.security.resolveActorPub(owner.actor.actorId)).toBeUndefined();

    const ownerLog = newLog();
    ownerLog.appendRoot(owner, tk, "");
    ownerLog.appendAdd(owner.actor, peerPub(member), tk, 0);
    await log.metaDoc.importUpdate(await ownerLog.metaDoc.exportSnapshot()); // member "receives" the roster

    // The next read sees the imported roster immediately (frontier moved → re-derive).
    expect(ms.isMember()).toBe(true);
    expect(eq(ms.security.transitKey, tk)).toBe(true); // the real key is installed on the security
    // resolveActorPub returns the sign pub recovered from the actorId (= hex of the sign pub).
    expect(eq(ms.security.resolveActorPub(owner.actor.actorId)!, owner.actor.publicKey)).toBe(true);
    expect(eq(ms.security.resolveActorPub(member.actor.actorId)!, member.actor.publicKey)).toBe(
      true,
    );
  });

  it("the derived security round-trips a sealed payload between owner and member", async () => {
    const owner = newLocal();
    const member = newLocal();
    const tk = randomBytes(32);
    const ownerLog = newLog();
    ownerLog.appendRoot(owner, tk, "");
    ownerLog.appendAdd(owner.actor, peerPub(member), tk, 0);
    const memberLog = newLog();
    await memberLog.metaDoc.importUpdate(await ownerLog.metaDoc.exportSnapshot());

    const ownerSec = createMembershipWireSecurity({ log: ownerLog, local: owner });
    const memberSec = createMembershipWireSecurity({ log: memberLog, local: member });

    const blob = seal(ownerSec.security, enc("members-only payload"));
    expect(Buffer.from(open(memberSec.security, blob)).toString()).toBe("members-only payload");
    expect(Buffer.from(open(ownerSec.security, blob)).toString()).toBe("members-only payload");
  });

  it("reflects a governance rotation on the next read (the transit key changes)", async () => {
    const owner = newLocal();
    const member = newLocal();
    const k0 = randomBytes(32);
    const k1 = randomBytes(32);
    const ownerLog = newLog();
    ownerLog.appendRoot(owner, k0, "");
    ownerLog.appendAdd(owner.actor, peerPub(member), k0, 0);
    const memberLog = newLog();
    await memberLog.metaDoc.importUpdate(await ownerLog.metaDoc.exportSnapshot());

    const memberSec = createMembershipWireSecurity({ log: memberLog, local: member });
    expect(eq(memberSec.security.transitKey, k0)).toBe(true);

    // Owner rotates the transit key (owner + member peers survive). Member converges; the next read
    // reflects it (frontier moved → re-derive → new key), no refresh step.
    ownerLog.appendRotate(owner.actor, [peerPub(owner), peerPub(member)], k1, k0, 1);
    await memberLog.metaDoc.importUpdate(await ownerLog.metaDoc.exportSnapshot());
    expect(eq(memberSec.security.transitKey, k1)).toBe(true);
  });
});

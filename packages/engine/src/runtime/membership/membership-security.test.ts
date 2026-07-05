import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MembershipLog, type LocalPeer } from "./membership-log.js";
import { generateActorKeypair, generatePeerKeypair } from "../../utils/crypto/index.js";
import { createMembershipWireSecurity } from "./membership-security.js";
import { open, seal } from "./wire-security.js";

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
  it("installs the transit key + flips isMember on refresh() once the log converges the peer", () => {
    const owner = newLocal();
    const member = newLocal();
    const tk = randomBytes(32);

    // The member's log starts EMPTY — it converges the roster separately (here, by importing it).
    const log = new MembershipLog();
    const ms = createMembershipWireSecurity({ log, local: member });

    ms.refresh();
    expect(ms.isMember()).toBe(false); // peer not admitted yet → host skips the sealed content round
    expect(ms.security.resolveActorPub(owner.actor.actorId)).toBeUndefined();

    const ownerLog = new MembershipLog();
    ownerLog.appendRoot(owner, tk, "");
    ownerLog.appendAdd(owner.actor, peerPub(member), tk, 0);
    log.toSyncDoc().importUpdate(ownerLog.toSyncDoc().exportSnapshot()); // member "receives" the roster

    ms.refresh();
    expect(ms.isMember()).toBe(true);
    expect(eq(ms.security.transitKey, tk)).toBe(true); // the real key is installed on the security
    // resolveActorPub returns the sign pub recovered from the actorId (= hex of the sign pub).
    expect(eq(ms.security.resolveActorPub(owner.actor.actorId)!, owner.actor.publicKey)).toBe(true);
    expect(eq(ms.security.resolveActorPub(member.actor.actorId)!, member.actor.publicKey)).toBe(
      true,
    );
  });

  it("the derived security round-trips a sealed payload between owner and member", () => {
    const owner = newLocal();
    const member = newLocal();
    const tk = randomBytes(32);
    const ownerLog = new MembershipLog();
    ownerLog.appendRoot(owner, tk, "");
    ownerLog.appendAdd(owner.actor, peerPub(member), tk, 0);
    const memberLog = new MembershipLog();
    memberLog.toSyncDoc().importUpdate(ownerLog.toSyncDoc().exportSnapshot());

    const ownerSec = createMembershipWireSecurity({ log: ownerLog, local: owner });
    const memberSec = createMembershipWireSecurity({ log: memberLog, local: member });
    ownerSec.refresh();
    memberSec.refresh();

    const blob = seal(ownerSec.security, enc("members-only payload"));
    expect(Buffer.from(open(memberSec.security, blob)).toString()).toBe("members-only payload");
    expect(Buffer.from(open(ownerSec.security, blob)).toString()).toBe("members-only payload");
  });

  it("refresh() reflects a governance rotation (the installed transit key changes)", () => {
    const owner = newLocal();
    const member = newLocal();
    const k0 = randomBytes(32);
    const k1 = randomBytes(32);
    const ownerLog = new MembershipLog();
    ownerLog.appendRoot(owner, k0, "");
    ownerLog.appendAdd(owner.actor, peerPub(member), k0, 0);
    const memberLog = new MembershipLog();
    memberLog.toSyncDoc().importUpdate(ownerLog.toSyncDoc().exportSnapshot());

    const memberSec = createMembershipWireSecurity({ log: memberLog, local: member });
    memberSec.refresh();
    expect(eq(memberSec.security.transitKey, k0)).toBe(true);

    // Owner rotates the transit key (owner + member peers survive). Member converges + refreshes.
    ownerLog.appendRotate(owner.actor, [peerPub(owner), peerPub(member)], k1, k0, 1);
    memberLog.toSyncDoc().importUpdate(ownerLog.toSyncDoc().exportSnapshot());
    memberSec.refresh();
    expect(eq(memberSec.security.transitKey, k1)).toBe(true);
  });
});

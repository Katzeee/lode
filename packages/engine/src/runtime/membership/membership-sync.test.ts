import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  actorEncryptionPublic,
  generateActorKeypair,
  type ActorKeypair,
} from "../../utils/crypto/index.js";
import { MembershipLog, type MemberPublicKeys } from "./membership-log.js";
import { MembershipSync } from "./membership-sync.js";
import type { SyncProfile, SyncTransport } from "../sync.js";

const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));
const memberPub = (m: ActorKeypair): MemberPublicKeys => ({
  actorId: m.actorId,
  signPub: m.publicKey,
  encPub: actorEncryptionPublic(m.publicKey),
});

/** A one-way push pipe between two logs (models the broker's pub/sub for the membership doc): A's
 *  `sendUpdates` delivers into B's doc, and vice versa. `remoteProfile`/`fetchUpdates` are unused —
 *  MembershipSync is push-only by design (bootstrap: the log converges before the transit key). */
function pipe(a: MembershipLog, b: MembershipLog): { ta: SyncTransport; tb: SyncTransport } {
  const make = (target: MembershipLog): SyncTransport => ({
    remoteProfile: () => Promise.resolve([] as SyncProfile),
    fetchUpdates: () => Promise.resolve(new Uint8Array(0)),
    sendUpdates: (_docId, bytes) => {
      target.toSyncDoc().importUpdate(bytes);
      return Promise.resolve();
    },
  });
  return { ta: make(b), tb: make(a) }; // A pushes → into B; B pushes → into A
}

describe("MembershipSync — plaintext gossip convergence", () => {
  it("a joining member converges the roster from the owner and then unwraps the transit key", async () => {
    const owner = generateActorKeypair();
    const member = generateActorKeypair();
    const tk = randomBytes(32);

    // Owner bootstraps; the member's log starts EMPTY — it must learn everything via gossip.
    const ownerLog = new MembershipLog();
    ownerLog.appendRoot(owner, tk);
    ownerLog.appendAdd(owner, memberPub(member), tk, 0);
    const memberLog = new MembershipLog();

    const { ta, tb } = pipe(ownerLog, memberLog);
    const ownerSync = new MembershipSync(ta, ownerLog.toSyncDoc());
    const memberSync = new MembershipSync(tb, memberLog.toSyncDoc());

    // Gossip rounds: owner pushes → member imports; member pushes back → owner imports (no-op).
    await ownerSync.sync();
    await memberSync.sync();
    await ownerSync.sync();

    const { state, skipped } = memberLog.deriveState();
    expect(skipped).toHaveLength(0);
    expect(state.owner).toBe(owner.actorId);
    expect(state.members.has(member.actorId)).toBe(true);
    expect(eq(memberLog.unwrapCurrentTransitKey(state, member), tk)).toBe(true);
  });

  it("is idempotent across repeated rounds (CRDT merge of the same records)", async () => {
    const owner = generateActorKeypair();
    const tk = randomBytes(32);
    const a = new MembershipLog();
    a.appendRoot(owner, tk);
    const b = new MembershipLog();
    const { ta, tb } = pipe(a, b);
    const sa = new MembershipSync(ta, a.toSyncDoc());
    const sb = new MembershipSync(tb, b.toSyncDoc());
    for (let i = 0; i < 5; i++) {
      await sa.sync();
      await sb.sync();
    }
    expect(b.deriveState().state.owner).toBe(owner.actorId);
    expect(b.records()).toHaveLength(1); // root only, not duplicated by re-push
  });
});

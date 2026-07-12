import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateActorKeypair, generatePeerKeypair } from "../../crypto/index.js";
import { MembershipLog, MEMBERSHIP_DOC_ID, type LocalPeer } from "../membership/membership-log.js";
import { MembershipSync } from "./membership-sync.js";
import type { SyncProfile, SyncTransport } from "./transport.js";
import { LoroMetaDoc } from "../../core/store/meta-doc.js";

/** Construct a MembershipLog backed by a fresh LoroMetaDoc (the production backing). */
const newLog = (persistence?: ConstructorParameters<typeof MembershipLog>[1]): MembershipLog =>
  new MembershipLog(new LoroMetaDoc(MEMBERSHIP_DOC_ID), persistence);

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

/** A one-way push pipe between two logs (models the broker's pub/sub for the membership doc): A's
 *  `sendUpdates` delivers into B's doc, and vice versa. `remoteProfile`/`fetchUpdates` are unused —
 *  MembershipSync is push-only by design (bootstrap: the log converges before the transit key). */
function pipe(a: MembershipLog, b: MembershipLog): { ta: SyncTransport; tb: SyncTransport } {
  const make = (target: MembershipLog): SyncTransport => ({
    remoteProfile: () => Promise.resolve([] as SyncProfile),
    fetchUpdates: () => Promise.resolve(new Uint8Array(0)),
    sendUpdates: async (_docId, bytes) => {
      await target.metaDoc.importUpdate(bytes);
    },
    // MembershipSync is push-only; the directed/bootstrap methods are never called here.
    directedFetchUpdates: () => Promise.resolve(new Uint8Array(0)),
    peers: () => Promise.resolve([]),
  });
  return { ta: make(b), tb: make(a) }; // A pushes → into B; B pushes → into A
}

describe("MembershipSync — plaintext gossip convergence", () => {
  it("a joining peer converges the roster from the owner and then unwraps the transit key", async () => {
    const owner = newLocal();
    const member = newLocal();
    const tk = randomBytes(32);

    // Owner bootstraps; the member's log starts EMPTY — it must learn everything via gossip.
    const ownerLog = newLog();
    ownerLog.appendRoot(owner, tk, "");
    ownerLog.appendAdd(owner.actor, peerPub(member), tk, 0);
    const memberLog = newLog();

    const { ta, tb } = pipe(ownerLog, memberLog);
    const ownerSync = new MembershipSync(ta, ownerLog.metaDoc);
    const memberSync = new MembershipSync(tb, memberLog.metaDoc);

    // Gossip rounds: owner pushes → member imports; member pushes back → owner imports (no-op).
    await ownerSync.sync();
    await memberSync.sync();
    await ownerSync.sync();

    const { state, skipped } = memberLog.deriveState();
    expect(skipped).toHaveLength(0);
    expect(state.owner).toBe(owner.actor.actorId);
    expect(state.peers.has(member.peerId)).toBe(true);
    expect(eq(memberLog.unwrapCurrentTransitKey(state, member), tk)).toBe(true);
  });

  it("is idempotent across repeated rounds (CRDT merge of the same records)", async () => {
    const owner = newLocal();
    const tk = randomBytes(32);
    const a = newLog();
    a.appendRoot(owner, tk, "");
    const b = newLog();
    const { ta, tb } = pipe(a, b);
    const sa = new MembershipSync(ta, a.metaDoc);
    const sb = new MembershipSync(tb, b.metaDoc);
    for (let i = 0; i < 5; i++) {
      await sa.sync();
      await sb.sync();
    }
    expect(b.deriveState().state.owner).toBe(owner.actor.actorId);
    expect(b.records()).toHaveLength(1); // root only, not duplicated by re-push
  });
});

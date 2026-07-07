import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { generateActorKeypair, generatePeerKeypair } from "../../utils/crypto/index.js";
import { Engine } from "../../core/engine.js";
import { ShardedBlockStore } from "../../core/sharded-store.js";
import { WorkspaceDocSet } from "../../core/doc-set.js";
import type { MetaDoc } from "../../core/meta-doc.js";
import { SyncManager } from "../sync/sync-manager.js";
import { MembershipLog, MEMBERSHIP_DOC_ID, type LocalPeer } from "../membership/membership-log.js";
import { MembershipSync } from "../membership/membership-sync.js";
import { createMembershipWireSecurity } from "../membership/membership-security.js";
import { BrokerClient } from "./broker-client.js";
import { BrokerServer } from "./broker-server.js";
import { BrokerSyncProtocol } from "./broker-sync-transport.js";
import { LoroMetaDoc } from "../../core/meta-doc.js";

/** Construct a MembershipLog backed by a fresh LoroMetaDoc (the production backing). */
const newLog = (persistence?: ConstructorParameters<typeof MembershipLog>[1]): MembershipLog =>
  new MembershipLog(new LoroMetaDoc(MEMBERSHIP_DOC_ID), persistence);

/** A docSet wrapping the outliner + the membership meta doc registered `public` — the production
 *  shape SyncContext builds. The broker reads visibility from the docSet, not a publicDocs thunk. */
const docSetWith = (store: ShardedBlockStore, meta: MetaDoc): WorkspaceDocSet => {
  const ds = new WorkspaceDocSet(store);
  ds.registerMeta(meta, "public");
  return ds;
};

// Transport integration: one secured transport carries the membership doc over a PLAINTEXT
// envelope (0x00 tag) and content docs over a SEALED envelope (0x01 tag). The membership doc converges
// via gossip push BEFORE the member holds the transit key (bootstrap), then content converges sealed.

let server: BrokerServer | undefined;
const transports: BrokerSyncProtocol[] = [];
const eavesdroppers: BrokerClient[] = [];

afterEach(async () => {
  for (const t of transports) {
    t.close();
  }
  transports.length = 0;
  for (const e of eavesdroppers) {
    e.close();
  }
  eavesdroppers.length = 0;
  if (server) {
    await server.close();
    server = undefined;
  }
});

const settle = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));

function newEngine(): { engine: Engine; store: ShardedBlockStore } {
  const store = new ShardedBlockStore({ numShards: 4 });
  return { engine: new Engine({ store }), store };
}

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

describe("BrokerSyncProtocol — membership-doc plaintext + content sealed", () => {
  it("membership doc converges plaintext, content converges sealed; eavesdropper sees both tags but no plaintext content", async () => {
    const a = newEngine();
    const b = newEngine();
    const root = await a.engine.createNode(null);
    const page = await a.engine.createNode(root.occurrenceId, undefined, { kind: "page" });
    const SECRET = "sealed-content-sentinel";
    await a.engine.replaceDeltas(page.occurrenceId, [{ insert: SECRET }]);

    const owner = newLocal();
    const member = newLocal();
    const tk = randomBytes(32);
    const logA = newLog();
    logA.appendRoot(owner, tk, "");
    logA.appendAdd(owner.actor, peerPub(member), tk, 0);
    const logB = newLog(); // member log EMPTY — converges via plaintext gossip

    const secA = createMembershipWireSecurity({ log: logA, local: owner });
    const secB = createMembershipWireSecurity({ log: logB, local: member });

    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    const ta = new BrokerSyncProtocol({
      url,
      docSet: docSetWith(a.store, logA.metaDoc),
      workspaceId: "W",
      security: secA.security,
    });
    const tb = new BrokerSyncProtocol({
      url,
      docSet: docSetWith(b.store, logB.metaDoc),
      workspaceId: "W",
      security: secB.security,
    });
    transports.push(ta, tb);
    await Promise.all([ta.open(), tb.open()]);

    const wiretap: Uint8Array[] = [];
    const eavesdropper = new BrokerClient({ url, onDeliver: (_ws, p) => wiretap.push(p) });
    eavesdroppers.push(eavesdropper);
    await eavesdropper.open();
    eavesdropper.subscribe("W");
    await settle();

    // (1) Membership gossip (plaintext): owner pushes → member imports. Refresh so the member's
    //     security installs the transit key before the sealed content round.
    const syncA = new MembershipSync(ta, logA.metaDoc);
    const syncB = new MembershipSync(tb, logB.metaDoc);
    await syncA.sync();
    await settle();
    await syncB.sync();
    await settle();
    await syncA.sync();
    await settle();
    secA.refresh();
    secB.refresh();
    expect(secB.isMember()).toBe(true);
    expect(
      Buffer.from(logB.unwrapCurrentTransitKey(logB.deriveState().state, member)).equals(tk),
    ).toBe(true);

    // (2) Content (sealed): converges now that B can unwrap the transit key.
    const ma = new SyncManager(a.store, ta);
    const mb = new SyncManager(b.store, tb);
    await ma.sync();
    await mb.sync();
    expect((await b.engine.getOccurrence(page.occurrenceId))?.deltas).toEqual([{ insert: SECRET }]);

    // (3) The eavesdropper saw BOTH envelopes on the wire...
    expect(wiretap.some((p) => p[0] === 0x00)).toBe(true); // plaintext membership push (public roster)
    expect(wiretap.some((p) => p[0] === 0x01)).toBe(true); // sealed content/profile
    // ...but the plaintext content sentinel NEVER appears (content is AEAD-sealed).
    const secretBytes = new TextEncoder().encode(SECRET);
    expect(wiretap.some((blob) => Buffer.from(blob).includes(Buffer.from(secretBytes)))).toBe(
      false,
    );
  });

  it("a non-member (no transit key) cannot make content converge even if it somehow subscribes", async () => {
    const a = newEngine();
    const b = newEngine();
    const root = await a.engine.createNode(null);
    const page = await a.engine.createNode(root.occurrenceId, undefined, { kind: "page" });
    await a.engine.replaceDeltas(page.occurrenceId, [{ insert: "members-only" }]);

    const owner = newLocal();
    const stranger = newLocal(); // NOT added to the membership
    const tk = randomBytes(32);
    const logA = newLog();
    logA.appendRoot(owner, tk, ""); // owner only — stranger is not a member
    const logB = newLog(); // stranger's log never receives an `add` for itself

    const secA = createMembershipWireSecurity({ log: logA, local: owner });
    const secB = createMembershipWireSecurity({ log: logB, local: stranger });

    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    const ta = new BrokerSyncProtocol({
      url,
      docSet: docSetWith(a.store, logA.metaDoc),
      workspaceId: "W",
      security: secA.security,
    });
    const tb = new BrokerSyncProtocol({
      url,
      docSet: docSetWith(b.store, logB.metaDoc),
      workspaceId: "W",
      security: secB.security, // stranger resolves pubs but holds no transit key (not a member)
      responseTimeoutMs: 80,
    });
    transports.push(ta, tb);
    await Promise.all([ta.open(), tb.open()]);
    await settle();

    // The stranger converges the PUBLIC roster (plaintext) — it sees the owner — but it is not a
    // member, so secB never installs a transit key and content sync (sealed) fails every round.
    const syncA = new MembershipSync(ta, logA.metaDoc);
    const syncB = new MembershipSync(tb, logB.metaDoc);
    await syncA.sync();
    await settle();
    await syncB.sync();
    await settle();
    await syncA.sync();
    await settle();
    secA.refresh();
    secB.refresh();
    expect(secB.isMember()).toBe(false);

    const mb = new SyncManager(b.store, tb);
    await expect(mb.sync()).rejects.toThrow(); // sealed exchange can't succeed without the transit key
    expect((await b.engine.getOccurrence(page.occurrenceId))?.deltas).toBeUndefined();
  });
});

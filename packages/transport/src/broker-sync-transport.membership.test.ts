import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  Engine,
  MembershipLog,
  MembershipSync,
  ShardedBlockStore,
  SyncManager,
  actorEncryptionPublic,
  createMembershipWireSecurity,
  generateActorKeypair,
  type ActorKeypair,
} from "@lode/engine";
import { BrokerClient } from "./broker-client.js";
import { BrokerClientSyncTransport } from "./broker-sync-transport.js";
import { BrokerServer } from "./broker-server.js";

// Transport integration: one secured transport carries the membership doc over a PLAINTEXT
// envelope (0x00 tag) and content docs over a SEALED envelope (0x01 tag). The membership doc converges
// via gossip push BEFORE the member holds the transit key (bootstrap), then content converges sealed.

let server: BrokerServer | undefined;
const transports: BrokerClientSyncTransport[] = [];
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

describe("BrokerClientSyncTransport — membership-doc plaintext + content sealed", () => {
  it("membership doc converges plaintext, content converges sealed; eavesdropper sees both tags but no plaintext content", async () => {
    const a = newEngine();
    const b = newEngine();
    const root = a.engine.createNode(null);
    const page = a.engine.createNode(root.occurrenceId, undefined, { kind: "page" });
    const SECRET = "sealed-content-sentinel";
    a.engine.replaceDeltas(page.occurrenceId, [{ insert: SECRET }]);

    const owner = generateActorKeypair();
    const member = generateActorKeypair();
    const tk = randomBytes(32);
    const logA = new MembershipLog();
    logA.appendRoot(owner, tk);
    logA.appendAdd(owner, memberPub(member), tk, 0);
    const logB = new MembershipLog(); // member log EMPTY — converges via plaintext gossip

    const secA = createMembershipWireSecurity({ log: logA, keypair: owner });
    const secB = createMembershipWireSecurity({ log: logB, keypair: member });

    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const ta = new BrokerClientSyncTransport({
      url,
      store: a.store,
      workspaceId: "W",
      security: secA.security,
      publicDocs: () => [logA.toSyncDoc()],
    });
    const tb = new BrokerClientSyncTransport({
      url,
      store: b.store,
      workspaceId: "W",
      security: secB.security,
      publicDocs: () => [logB.toSyncDoc()],
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
    const syncA = new MembershipSync(ta, logA.toSyncDoc());
    const syncB = new MembershipSync(tb, logB.toSyncDoc());
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
    expect(b.engine.getOccurrence(page.occurrenceId)?.deltas).toEqual([{ insert: SECRET }]);

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
    const root = a.engine.createNode(null);
    const page = a.engine.createNode(root.occurrenceId, undefined, { kind: "page" });
    a.engine.replaceDeltas(page.occurrenceId, [{ insert: "members-only" }]);

    const owner = generateActorKeypair();
    const stranger = generateActorKeypair(); // NOT added to the membership
    const tk = randomBytes(32);
    const logA = new MembershipLog();
    logA.appendRoot(owner, tk); // owner only — stranger is not a member
    const logB = new MembershipLog(); // stranger's log never receives an `add` for itself

    const secA = createMembershipWireSecurity({ log: logA, keypair: owner });
    const secB = createMembershipWireSecurity({ log: logB, keypair: stranger });

    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const ta = new BrokerClientSyncTransport({
      url,
      store: a.store,
      workspaceId: "W",
      security: secA.security,
      publicDocs: () => [logA.toSyncDoc()],
    });
    const tb = new BrokerClientSyncTransport({
      url,
      store: b.store,
      workspaceId: "W",
      security: secB.security, // stranger resolves pubs but holds no transit key (not a member)
      publicDocs: () => [logB.toSyncDoc()],
      responseTimeoutMs: 80,
    });
    transports.push(ta, tb);
    await Promise.all([ta.open(), tb.open()]);
    await settle();

    // The stranger converges the PUBLIC roster (plaintext) — it sees the owner — but it is not a
    // member, so secB never installs a transit key and content sync (sealed) fails every round.
    const syncA = new MembershipSync(ta, logA.toSyncDoc());
    const syncB = new MembershipSync(tb, logB.toSyncDoc());
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
    expect(b.engine.getOccurrence(page.occurrenceId)?.deltas).toBeUndefined();
  });
});

function memberPub(m: ActorKeypair) {
  return { actorId: m.actorId, signPub: m.publicKey, encPub: actorEncryptionPublic(m.publicKey) };
}

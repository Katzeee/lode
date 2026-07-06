import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { generateActorKeypair } from "../../utils/crypto/index.js";
import { Engine } from "../../core/engine.js";
import { ShardedBlockStore } from "../../core/sharded-store.js";
import { SyncManager } from "../sync/sync-manager.js";
import { open, type WireSecurity } from "../membership/wire-security.js";
import { BrokerClient } from "./broker-client.js";
import { BrokerServer } from "./broker-server.js";
import { BrokerSyncProtocol } from "./broker-sync-transport.js";

// Secured-transport e2e: transit-key AEAD + actor signing over the real broker. Split out from
// broker-sync-transport.test.ts (which covers the plaintext transport contract) so neither file
// exceeds the max-lines lint cap.

let server: BrokerServer | undefined;
const transports: BrokerSyncProtocol[] = [];

afterEach(async () => {
  for (const t of transports) {
    t.close();
  }
  transports.length = 0;
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

describe("BrokerSyncProtocol — secured (transit-key AEAD + actor signing)", () => {
  it("two secured transports converge; an eavesdropper on the workspace cannot decode the traffic", async () => {
    const a = newEngine();
    const b = newEngine();
    const root = a.engine.createNode(null);
    const page = a.engine.createNode(root.occurrenceId, undefined, { kind: "page" });
    const SECRET = "top-secret-page-text";
    a.engine.replaceDeltas(page.occurrenceId, [{ insert: SECRET }]);

    // Two members share a transit key + mutually know each other's actor pubkey.
    const tk = randomBytes(32);
    const actorA = generateActorKeypair();
    const actorB = generateActorKeypair();
    const pubs = new Map([
      [actorA.actorId, actorA.publicKey],
      [actorB.actorId, actorB.publicKey],
    ]);
    const sec = (own: { actorId: string; privateKey: typeof actorA.privateKey }): WireSecurity => ({
      transitKey: tk,
      actorId: own.actorId,
      actorPrivateKey: own.privateKey,
      resolveActorPub: (id) => pubs.get(id),
    });

    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    const ta = new BrokerSyncProtocol({
      url,
      store: a.store,
      workspaceId: "W",
      security: sec(actorA),
    });
    const tb = new BrokerSyncProtocol({
      url,
      store: b.store,
      workspaceId: "W",
      security: sec(actorB),
    });
    transports.push(ta, tb);
    await Promise.all([ta.open(), tb.open()]);

    // An eavesdropper: a 3rd client subscribed to the SAME workspace (the relay routes to all
    // subscribers) but with NO transit key / membership.
    const wiretap: Uint8Array[] = [];
    const eavesdropper = new BrokerClient({
      url,
      onDeliver: (_ws, payload) => wiretap.push(payload),
    });
    await eavesdropper.open();
    eavesdropper.subscribe("W");
    await settle();

    const ma = new SyncManager(a.store, ta);
    const mb = new SyncManager(b.store, tb);
    await ma.sync();
    await mb.sync();
    eavesdropper.close();

    // (1) Members still converge over the encrypted channel.
    expect(b.engine.getOccurrence(page.occurrenceId)?.deltas).toEqual([{ insert: SECRET }]);

    // (2) The relay/eavesdropper saw traffic (the broker routed sealed blobs to all subscribers)...
    expect(wiretap.length).toBeGreaterThan(0);
    // ...but the plaintext NEVER appears in any routed blob (content-blind + confidential).
    const secretBytes = new TextEncoder().encode(SECRET);
    expect(wiretap.some((blob) => Buffer.from(blob).includes(Buffer.from(secretBytes)))).toBe(
      false,
    );
    // ...and the eavesdropper cannot open a blob (no transit key / unknown actor).
    const sample = wiretap.at(0);
    if (!sample) {
      throw new Error("expected a routed blob");
    }
    expect(() =>
      open({ transitKey: randomBytes(32), resolveActorPub: () => undefined }, sample),
    ).toThrow();
  });

  it("a peer that trusts nobody rejects every payload and cannot converge (isolation)", async () => {
    const a = newEngine();
    const b = newEngine();
    const tk = randomBytes(32);
    const actorA = generateActorKeypair();
    const actorB = generateActorKeypair();
    // A trusts B; B trusts NOBODY. B therefore can't open even the responses to its OWN requests,
    // so neither direction completes (both time out) and B never receives A's content.
    const secA: WireSecurity = {
      transitKey: tk,
      actorId: actorA.actorId,
      actorPrivateKey: actorA.privateKey,
      resolveActorPub: (id) => (id === actorB.actorId ? actorB.publicKey : undefined),
    };
    const secB: WireSecurity = {
      transitKey: tk,
      actorId: actorB.actorId,
      actorPrivateKey: actorB.privateKey,
      resolveActorPub: () => undefined, // B trusts nobody → drops every incoming payload
    };

    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    const ta = new BrokerSyncProtocol({
      url,
      store: a.store,
      workspaceId: "W",
      security: secA,
      responseTimeoutMs: 80,
    });
    const tb = new BrokerSyncProtocol({
      url,
      store: b.store,
      workspaceId: "W",
      security: secB,
      responseTimeoutMs: 80,
    });
    transports.push(ta, tb);
    await Promise.all([ta.open(), tb.open()]);
    await settle();

    const root = a.engine.createNode(null);
    const page = a.engine.createNode(root.occurrenceId, undefined, { kind: "page" });
    a.engine.replaceDeltas(page.occurrenceId, [{ insert: "members-only" }]);

    const ma = new SyncManager(a.store, ta);
    const mb = new SyncManager(b.store, tb);
    // Both rounds time out: A's reqs are dropped by B; B's reqs get responses from A but B drops them.
    await expect(ma.sync()).rejects.toThrow(/timeout|closed/);
    await expect(mb.sync()).rejects.toThrow(/timeout|closed/);

    // No content crossed — B did not converge.
    expect(b.engine.getOccurrence(page.occurrenceId)?.deltas).toBeUndefined();
  });
});

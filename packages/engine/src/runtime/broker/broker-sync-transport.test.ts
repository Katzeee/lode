import { afterEach, describe, expect, it } from "vitest";
import { Engine } from "../../core/engine.js";
import { ShardedBlockStore } from "../../core/sharded-store.js";
import { WorkspaceDocSet } from "../../core/doc-set.js";
import { SyncManager } from "../sync/sync-manager.js";
import { BrokerServer } from "./broker-server.js";
import { BrokerSyncProtocol } from "./broker-sync-transport.js";

/**
 * The earliest end-to-end milestone: two engine runtimes converge a workspace over a REAL broker
 * (real kernel HTTP/2 — no mock transport). Seeds content on A, drives a sync round both ways,
 * and asserts B's engine reads back A's content.
 */

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

/** Build an engine over a fresh sharded store; return both so tests use the store directly. */
function newEngine(): { engine: Engine; store: ShardedBlockStore } {
  const store = new ShardedBlockStore({ numShards: 4 });
  return { engine: new Engine({ store }), store };
}

describe("BrokerSyncProtocol — end-to-end sync over a real broker", () => {
  it("converges: content created on A is readable on B after a sync round both ways", async () => {
    const a = newEngine();
    const root = await a.engine.createNode(null);
    const page = await a.engine.createNode(root.occurrenceId, undefined, { kind: "page" });
    await a.engine.replaceDeltas(page.occurrenceId, [{ insert: "hello world" }]);

    const b = newEngine(); // empty — will receive A's content via sync

    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;

    const ta = new BrokerSyncProtocol({
      url,
      docSet: new WorkspaceDocSet(a.store),
      workspaceId: "W",
    });
    const tb = new BrokerSyncProtocol({
      url,
      docSet: new WorkspaceDocSet(b.store),
      workspaceId: "W",
    });
    transports.push(ta, tb);
    await Promise.all([ta.open(), tb.open()]);
    await settle(); // let both subscribes land on the server

    const ma = new SyncManager(a.store, ta);
    const mb = new SyncManager(b.store, tb);
    await ma.sync();
    await mb.sync();

    // B's engine now reads back A's content (the page text crossed the real broker + CRDT-merged).
    expect((await b.engine.getOccurrence(page.occurrenceId))?.deltas).toEqual([
      { insert: "hello world" },
    ]);
  });

  it("a second edit on A re-syncs to B (incremental convergence)", async () => {
    const a = newEngine();
    const b = newEngine();
    const root = await a.engine.createNode(null);
    const page = await a.engine.createNode(root.occurrenceId, undefined, { kind: "page" });
    await a.engine.replaceDeltas(page.occurrenceId, [{ insert: "first" }]);

    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    const ta = new BrokerSyncProtocol({
      url,
      docSet: new WorkspaceDocSet(a.store),
      workspaceId: "W",
    });
    const tb = new BrokerSyncProtocol({
      url,
      docSet: new WorkspaceDocSet(b.store),
      workspaceId: "W",
    });
    transports.push(ta, tb);
    await Promise.all([ta.open(), tb.open()]);
    await settle();

    const ma = new SyncManager(a.store, ta);
    const mb = new SyncManager(b.store, tb);
    await ma.sync();
    await mb.sync();
    expect((await b.engine.getOccurrence(page.occurrenceId))?.deltas).toEqual([
      { insert: "first" },
    ]);

    // A edits again; another round propagates the change.
    await a.engine.replaceDeltas(page.occurrenceId, [{ insert: "second" }]);
    await ma.sync();
    await mb.sync();
    expect((await b.engine.getOccurrence(page.occurrenceId))?.deltas).toEqual([
      { insert: "second" },
    ]);
  });

  it("two peers each seeding different content converge to the union (CRDT merge)", async () => {
    const a = newEngine();
    const b = newEngine();
    const aRoot = await a.engine.createNode(null);
    const aPage = await a.engine.createNode(aRoot.occurrenceId, undefined, { kind: "page" });
    await a.engine.replaceDeltas(aPage.occurrenceId, [{ insert: "from A" }]);
    const bRoot = await b.engine.createNode(null);
    const bPage = await b.engine.createNode(bRoot.occurrenceId, undefined, { kind: "page" });
    await b.engine.replaceDeltas(bPage.occurrenceId, [{ insert: "from B" }]);

    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    const ta = new BrokerSyncProtocol({
      url,
      docSet: new WorkspaceDocSet(a.store),
      workspaceId: "W",
    });
    const tb = new BrokerSyncProtocol({
      url,
      docSet: new WorkspaceDocSet(b.store),
      workspaceId: "W",
    });
    transports.push(ta, tb);
    await Promise.all([ta.open(), tb.open()]);
    await settle();

    const ma = new SyncManager(a.store, ta);
    const mb = new SyncManager(b.store, tb);
    await ma.sync();
    await mb.sync();

    // Both peers see BOTH pages after merge.
    expect((await a.engine.getOccurrence(bPage.occurrenceId))?.deltas).toEqual([
      { insert: "from B" },
    ]);
    expect((await b.engine.getOccurrence(aPage.occurrenceId))?.deltas).toEqual([
      { insert: "from A" },
    ]);
  });
});

describe("BrokerSyncProtocol — transport contract (timeouts, lifecycle, robustness)", () => {
  it("rejects a request when no peer responds (timeout), with a short responseTimeoutMs", async () => {
    const a = newEngine();
    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    // A single transport, no other peer → its profileReq goes unanswered.
    const ta = new BrokerSyncProtocol({
      url,
      docSet: new WorkspaceDocSet(a.store),
      workspaceId: "W",
      responseTimeoutMs: 60,
    });
    transports.push(ta);
    await ta.open();
    await expect(ta.remoteProfile()).rejects.toThrow(/timeout/);
  });

  it("close() rejects in-flight requests instead of hanging", async () => {
    const a = newEngine();
    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    const ta = new BrokerSyncProtocol({
      url,
      docSet: new WorkspaceDocSet(a.store),
      workspaceId: "W",
      responseTimeoutMs: 5000,
    });
    transports.push(ta);
    await ta.open();
    const pending = ta.remoteProfile(); // no peer → would hang until the 5s timeout
    // Close mid-request: the promise must reject promptly with "closed", not hang.
    ta.close();
    await expect(pending).rejects.toThrow(/closed/);
  });
});

describe("BrokerSyncProtocol — multi-shard convergence", () => {
  it("syncs content spanning multiple shards; B's per-doc VVs converge to A's", async () => {
    const a = newEngine();
    const b = newEngine();
    // Seed enough nodes that they fan out across >1 shard (numShards:4).
    const root = await a.engine.createNode(null);
    for (let i = 0; i < 12; i++) {
      const node = await a.engine.createNode(root.occurrenceId, undefined, { kind: "page" });
      await a.engine.replaceDeltas(node.occurrenceId, [{ insert: `page-${i}` }]);
    }
    expect(a.store.docs().length).toBeGreaterThan(1); // ≥ treeDoc + a shard

    server = new BrokerServer();
    await server.ready();
    const url = `http://127.0.0.1:${server.port}`;
    const ta = new BrokerSyncProtocol({
      url,
      docSet: new WorkspaceDocSet(a.store),
      workspaceId: "W",
    });
    const tb = new BrokerSyncProtocol({
      url,
      docSet: new WorkspaceDocSet(b.store),
      workspaceId: "W",
    });
    transports.push(ta, tb);
    await Promise.all([ta.open(), tb.open()]);
    await settle();
    const ma = new SyncManager(a.store, ta);
    const mb = new SyncManager(b.store, tb);
    await ma.sync();
    await mb.sync();

    // B materialized the same shards and every doc's opaque version converged.
    expect(b.store.docs().length).toBe(a.store.docs().length);
    for (const ad of a.store.docs()) {
      const bd = b.store.docs().find((d) => d.id === ad.id);
      expect(bd && Buffer.from(await ad.version()).equals(Buffer.from(await bd.version()))).toBe(
        true,
      );
    }
  });
});

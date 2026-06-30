import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { Engine, ShardedBlockStore, SyncManager } from "@lode/engine";
import { BrokerClientSyncTransport } from "./broker-sync-transport.js";
import { BrokerServer } from "./broker-server.js";
import { encodeSyncMessage } from "./sync-message.js";

/**
 * The earliest end-to-end milestone: two engine runtimes converge a workspace over a REAL broker
 * (real kernel WebSockets — no mock transport). Seeds content on A, drives a sync round both ways,
 * and asserts B's engine reads back A's content.
 */

let server: BrokerServer | undefined;
const transports: BrokerClientSyncTransport[] = [];

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

describe("BrokerClientSyncTransport — end-to-end sync over a real broker", () => {
  it("converges: content created on A is readable on B after a sync round both ways", async () => {
    const a = newEngine();
    const root = a.engine.createNode(null);
    const page = a.engine.createNode(root.occurrenceId, undefined, { kind: "page" });
    a.engine.replaceDeltas(page.occurrenceId, [{ insert: "hello world" }]);

    const b = newEngine(); // empty — will receive A's content via sync

    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;

    const ta = new BrokerClientSyncTransport({ url, store: a.store, workspaceId: "W" });
    const tb = new BrokerClientSyncTransport({ url, store: b.store, workspaceId: "W" });
    transports.push(ta, tb);
    await Promise.all([ta.open(), tb.open()]);
    await settle(); // let both subscribes land on the server

    const ma = new SyncManager(a.store, ta);
    const mb = new SyncManager(b.store, tb);
    await ma.sync();
    await mb.sync();

    // B's engine now reads back A's content (the page text crossed the real broker + CRDT-merged).
    expect(b.engine.getOccurrence(page.occurrenceId)?.deltas).toEqual([{ insert: "hello world" }]);
  });

  it("a second edit on A re-syncs to B (incremental convergence)", async () => {
    const a = newEngine();
    const b = newEngine();
    const root = a.engine.createNode(null);
    const page = a.engine.createNode(root.occurrenceId, undefined, { kind: "page" });
    a.engine.replaceDeltas(page.occurrenceId, [{ insert: "first" }]);

    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const ta = new BrokerClientSyncTransport({ url, store: a.store, workspaceId: "W" });
    const tb = new BrokerClientSyncTransport({ url, store: b.store, workspaceId: "W" });
    transports.push(ta, tb);
    await Promise.all([ta.open(), tb.open()]);
    await settle();

    const ma = new SyncManager(a.store, ta);
    const mb = new SyncManager(b.store, tb);
    await ma.sync();
    await mb.sync();
    expect(b.engine.getOccurrence(page.occurrenceId)?.deltas).toEqual([{ insert: "first" }]);

    // A edits again; another round propagates the change.
    a.engine.replaceDeltas(page.occurrenceId, [{ insert: "second" }]);
    await ma.sync();
    await mb.sync();
    expect(b.engine.getOccurrence(page.occurrenceId)?.deltas).toEqual([{ insert: "second" }]);
  });

  it("two peers each seeding different content converge to the union (CRDT merge)", async () => {
    const a = newEngine();
    const b = newEngine();
    const aRoot = a.engine.createNode(null);
    const aPage = a.engine.createNode(aRoot.occurrenceId, undefined, { kind: "page" });
    a.engine.replaceDeltas(aPage.occurrenceId, [{ insert: "from A" }]);
    const bRoot = b.engine.createNode(null);
    const bPage = b.engine.createNode(bRoot.occurrenceId, undefined, { kind: "page" });
    b.engine.replaceDeltas(bPage.occurrenceId, [{ insert: "from B" }]);

    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const ta = new BrokerClientSyncTransport({ url, store: a.store, workspaceId: "W" });
    const tb = new BrokerClientSyncTransport({ url, store: b.store, workspaceId: "W" });
    transports.push(ta, tb);
    await Promise.all([ta.open(), tb.open()]);
    await settle();

    const ma = new SyncManager(a.store, ta);
    const mb = new SyncManager(b.store, tb);
    await ma.sync();
    await mb.sync();

    // Both peers see BOTH pages after merge.
    expect(a.engine.getOccurrence(bPage.occurrenceId)?.deltas).toEqual([{ insert: "from B" }]);
    expect(b.engine.getOccurrence(aPage.occurrenceId)?.deltas).toEqual([{ insert: "from A" }]);
  });
});

describe("BrokerClientSyncTransport — transport contract (timeouts, lifecycle, robustness)", () => {
  it("rejects a request when no peer responds (timeout), with a short responseTimeoutMs", async () => {
    const a = newEngine();
    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    // A single transport, no other peer → its profileReq goes unanswered.
    const ta = new BrokerClientSyncTransport({
      url,
      store: a.store,
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
    const url = `ws://127.0.0.1:${server.port}`;
    const ta = new BrokerClientSyncTransport({
      url,
      store: a.store,
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

  it("a malformed sync payload is dropped; the responder survives and keeps syncing", async () => {
    const a = newEngine();
    const b = newEngine();
    a.engine.createNode(null); // seed something on A
    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const ta = new BrokerClientSyncTransport({ url, store: a.store, workspaceId: "W" });
    const tb = new BrokerClientSyncTransport({ url, store: b.store, workspaceId: "W" });
    transports.push(ta, tb);
    await Promise.all([ta.open(), tb.open()]);
    await settle();
    // Inject a garbage sync payload from a raw socket.
    const raw = new WebSocket(url);
    raw.on("error", () => {});
    await new Promise<void>((res, rej) => {
      raw.once("open", () => res());
      raw.once("error", rej);
    });
    raw.send(
      encodeSyncMessage({ kind: "profileReq", reqId: "garbage-Ω-not-decodable-payload" }).subarray(
        0,
        3,
      ),
    );
    raw.send(Buffer.from("!!!not a sync message!!!"));
    await settle();
    raw.close();
    // B's responder survived: a normal sync still converges.
    const ma = new SyncManager(a.store, ta);
    const mb = new SyncManager(b.store, tb);
    await ma.sync();
    await mb.sync();
    // B now mirrors A's treeDoc (root node present) — version vectors equal.
    const aTree = a.store.syncDocs().find((d) => d.id === "main");
    const bTree = b.store.syncDocs().find((d) => d.id === "main");
    expect(aTree && bTree && aTree.version().compare(bTree.version()) === 0).toBe(true);
  });
});

describe("BrokerClientSyncTransport — multi-shard convergence", () => {
  it("syncs content spanning multiple shards; B's per-doc VVs converge to A's", async () => {
    const a = newEngine();
    const b = newEngine();
    // Seed enough nodes that they fan out across >1 shard (numShards:4).
    const root = a.engine.createNode(null);
    for (let i = 0; i < 12; i++) {
      const node = a.engine.createNode(root.occurrenceId, undefined, { kind: "page" });
      a.engine.replaceDeltas(node.occurrenceId, [{ insert: `page-${i}` }]);
    }
    expect(a.store.syncDocs().length).toBeGreaterThan(1); // ≥ treeDoc + a shard

    server = new BrokerServer();
    await server.ready();
    const url = `ws://127.0.0.1:${server.port}`;
    const ta = new BrokerClientSyncTransport({ url, store: a.store, workspaceId: "W" });
    const tb = new BrokerClientSyncTransport({ url, store: b.store, workspaceId: "W" });
    transports.push(ta, tb);
    await Promise.all([ta.open(), tb.open()]);
    await settle();
    const ma = new SyncManager(a.store, ta);
    const mb = new SyncManager(b.store, tb);
    await ma.sync();
    await mb.sync();

    // B materialized the same shards and every doc's VV converged.
    expect(b.store.syncDocs().length).toBe(a.store.syncDocs().length);
    for (const ad of a.store.syncDocs()) {
      const bd = b.store.syncDocs().find((d) => d.id === ad.id);
      expect(bd && ad.version().compare(bd.version()) === 0).toBe(true);
    }
  });
});

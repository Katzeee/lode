import { describe, expect, it } from "vitest";
import { Engine } from "../../core/engine.js";
import { ShardedBlockStore } from "../../core/sharded-store.js";
import { InMemorySyncTransport, SyncManager, type SyncTransport } from "./sync-manager.js";

const newStore = (): ShardedBlockStore => new ShardedBlockStore({ numShards: 4 });

/** A transport over a peer store that ALSO records every non-empty `sendUpdates` (docId → bytes[]),
 *  so a test can assert what `pushOnly` emitted while still delivering to the peer for convergence. */
function recording(peer: ShardedBlockStore): {
  transport: SyncTransport;
  sent: Map<string, Uint8Array[]>;
} {
  const sent = new Map<string, Uint8Array[]>();
  const inner = new InMemorySyncTransport(peer);
  return {
    sent,
    transport: {
      remoteProfile: () => inner.remoteProfile(),
      fetchUpdates: (id, from) => inner.fetchUpdates(id, from),
      sendUpdates: async (docId, bytes) => {
        if (bytes.length > 0) {
          const list = sent.get(docId) ?? [];
          list.push(bytes);
          sent.set(docId, list);
        }
        await inner.sendUpdates(docId, bytes);
      },
    },
  };
}

describe("SyncManager.sync() — return shape", () => {
  it("reports pulled/pushed doc counts (both directions exchange when both sides have content)", async () => {
    const aStore = newStore();
    new Engine({ store: aStore }).createNode(null);
    const bStore = newStore();
    new Engine({ store: bStore }).createNode(null);

    const r = await new SyncManager(aStore, new InMemorySyncTransport(bStore)).sync();

    expect(r.pulled).toBeGreaterThan(0); // B has its own ops A lacked
    expect(r.pushed).toBeGreaterThan(0); // A has its own ops B lacked
  });
});

describe("SyncManager.pushOnly() — the push fast-path", () => {
  it("is a no-op before the first round populates the remote-VV cache (cold start)", async () => {
    const aStore = newStore();
    const aEngine = new Engine({ store: aStore });
    aEngine.createNode(null); // A has content
    const { transport } = recording(newStore());
    const sm = new SyncManager(aStore, transport);

    // No sync() yet → lastRemoteVV empty → push no-ops even though A has content.
    const r = await sm.pushOnly();
    expect(r.pushed).toBe(0);
  });

  it("is idempotent: a second call with no further mutation re-exports the same bytes (no growth)", async () => {
    const aStore = newStore();
    const aEngine = new Engine({ store: aStore });
    const root = aEngine.createNode(null);
    const bStore = newStore();
    const { transport, sent } = recording(bStore);
    const sm = new SyncManager(aStore, transport);
    await sm.sync(); // populate lastRemoteVV
    aEngine.createNode(root.occurrenceId); // a mutation
    sent.clear(); // drop the sync() round's sends — measure pushOnly alone

    const totalBytes = () => [...sent.values()].flat().reduce((n, b) => n + b.length, 0);
    await sm.pushOnly();
    const after1 = totalBytes(); // bytes pushed by the 1st call
    await sm.pushOnly();
    const after2 = totalBytes(); // bytes pushed by 1st + 2nd

    // pushOnly does NOT refresh lastRemoteVV, so the 2nd call re-exports the same diff against the
    // same cached VV → identical byte volume (no growth). This is the design's stated behavior
    // (idempotent, bounded by the 20s tick that refreshes lastRemoteVV), not a bug.
    expect(after1).toBeGreaterThan(0);
    expect(after2 - after1).toBe(after1);
  });

  it("pushes a post-convergence mutation: pushed > 0, and the dirtied treeDoc is in the send log", async () => {
    const aStore = newStore();
    const aEngine = new Engine({ store: aStore });
    const root = aEngine.createNode(null);
    aEngine.createNode(root.occurrenceId);
    const bStore = newStore();
    const { transport, sent } = recording(bStore);
    const sm = new SyncManager(aStore, transport);
    await sm.sync(); // converge → lastRemoteVV populated
    sent.clear();

    aEngine.createNode(root.occurrenceId); // a NEW local mutation after convergence
    const r = await sm.pushOnly();

    expect(r.pushed).toBeGreaterThan(0);
    // A createNode always dirties the tree; assert it's in the push log.
    const treeId = aStore.treeSyncDoc().id;
    expect(sent.has(treeId)).toBe(true);
    expect(sent.get(treeId)!.length).toBeGreaterThan(0);
  });

  it("the remote-VV cache survives a mid-round throw: a failed sync() still leaves push able to run", async () => {
    const aStore = newStore();
    const aEngine = new Engine({ store: aStore });
    aEngine.createNode(null);
    const bStore = newStore();
    const bEngine = new Engine({ store: bStore });
    bEngine.createNode(null); // B non-empty → remoteProfile returns entries (non-empty cache)
    const inner = new InMemorySyncTransport(bStore);
    const throwing: SyncTransport = {
      remoteProfile: () => inner.remoteProfile(),
      // fetchUpdates throws → exchangeDoc throws → sync() rejects. But lastRemoteVV was already
      // written (before the per-doc loop), so pushOnly is not stranded on cold start.
      fetchUpdates: () => Promise.reject(new Error("relay blip")),
      sendUpdates: () => Promise.resolve(),
    };
    const sm = new SyncManager(aStore, throwing);
    await expect(sm.sync()).rejects.toThrow(/relay blip/);

    // pushOnly proceeds (cache populated by the partial round) and pushes A's docs.
    const r = await sm.pushOnly();
    expect(r.pushed).toBeGreaterThan(0);
  });
});

describe("Engine.importUpdate — merge-path termination (no re-export pump)", () => {
  it("re-importing already-known bytes is a no-op: fires no nodeUpdated, advances no VV", async () => {
    // CRDT merge itself is Loro's job (in-version ops apply idempotently); this locks in that our
    // integration doesn't turn import into a re-export pump. The load-bearing assertion is that
    // import fires no `nodeUpdated`: PushFastPath subscribes to exactly that
    // signal, so if import emitted it, every received update would re-trigger a push —
    //   recv → import → nodeUpdated → schedulePush → export → send → recv → … (never halts).
    // Guards against someone later adding an import-time callback that emits nodeUpdated.
    const aStore = newStore();
    const aEngine = new Engine({ store: aStore });
    aEngine.createNode(null); // dirties the treeDoc ("main")
    const bStore = newStore();
    const { transport } = recording(bStore);
    await new SyncManager(aStore, transport).sync(); // A ↔ B converge; A holds both peers' treeDoc ops

    // A's full treeDoc update (every op A holds), fed straight back into A via the composite's tree
    // SyncableDoc — the surface sync/persist use (Engine no longer exposes export/import).
    const treeDoc = aStore.treeSyncDoc();
    const aBytes = treeDoc.exportUpdate();
    expect(aBytes.length).toBeGreaterThan(0); // non-empty so the no-op below is meaningful

    let fired = 0;
    const sub = aEngine.slots.nodeUpdated.subscribe(() => {
      fired++;
    });
    try {
      const vvBefore = treeDoc.version();
      treeDoc.importUpdate(aBytes);
      const vvAfter = treeDoc.version();

      expect(fired).toBe(0); // import emits no nodeUpdated → nothing re-triggers a push
      // CRDT applies in-version ops idempotently → the opaque version bytes are unchanged.
      expect(Buffer.from(vvAfter).equals(Buffer.from(vvBefore))).toBe(true);
    } finally {
      sub.unsubscribe();
    }
  });
});

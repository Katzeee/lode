import { describe, expect, it } from "vitest";
import { NoopWorkspaceLock } from "../workspace/loro-lock.js";
import { Engine } from "../../core/engine.js";
import { ShardedBlockStore } from "../../core/store/sharded-store.js";
import { InMemorySyncTransport, SyncExchange } from "./sync-exchange.js";
import type { SyncTransport } from "./transport.js";

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
      directedFetchUpdates: (id, from, to) => inner.directedFetchUpdates(id, from, to),
      peers: () => inner.peers(),
    },
  };
}

describe("SyncExchange.sync() — return shape", () => {
  it("reports pulled/pushed doc counts (both directions exchange when both sides have content)", async () => {
    const aStore = newStore();
    await new Engine({ store: aStore }).createNode(null);
    const bStore = newStore();
    await new Engine({ store: bStore }).createNode(null);

    const r = await new SyncExchange(
      aStore,
      new InMemorySyncTransport(bStore),
      new NoopWorkspaceLock(),
    ).sync();

    expect(r.pulled).toBeGreaterThan(0); // B has its own ops A lacked
    expect(r.pushed).toBeGreaterThan(0); // A has its own ops B lacked
  });
});

describe("SyncExchange.pushOnly() — the push fast-path", () => {
  it("is a no-op before the first round populates the remote-VV cache (cold start)", async () => {
    const aStore = newStore();
    const aEngine = new Engine({ store: aStore });
    await aEngine.createNode(null); // A has content
    const { transport } = recording(newStore());
    const sm = new SyncExchange(aStore, transport, new NoopWorkspaceLock());

    // No sync() yet → lastRemoteVV empty → push no-ops even though A has content.
    const r = await sm.pushOnly();
    expect(r.pushed).toBe(0);
  });

  it("is idempotent: a second call with no further mutation re-exports the same bytes (no growth)", async () => {
    const aStore = newStore();
    const aEngine = new Engine({ store: aStore });
    const root = await aEngine.createNode(null);
    const bStore = newStore();
    const { transport, sent } = recording(bStore);
    const sm = new SyncExchange(aStore, transport, new NoopWorkspaceLock());
    await sm.sync(); // populate lastRemoteVV
    await aEngine.createNode(root.occurrenceId); // a mutation
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
    const root = await aEngine.createNode(null);
    await aEngine.createNode(root.occurrenceId);
    const bStore = newStore();
    const { transport, sent } = recording(bStore);
    const sm = new SyncExchange(aStore, transport, new NoopWorkspaceLock());
    await sm.sync(); // converge → lastRemoteVV populated
    sent.clear();

    await aEngine.createNode(root.occurrenceId); // a NEW local mutation after convergence
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
    await aEngine.createNode(null);
    const bStore = newStore();
    const bEngine = new Engine({ store: bStore });
    await bEngine.createNode(null); // B non-empty → remoteProfile returns entries (non-empty cache)
    const inner = new InMemorySyncTransport(bStore);
    const throwing: SyncTransport = {
      remoteProfile: () => inner.remoteProfile(),
      // fetchUpdates throws → exchangeDoc throws → sync() rejects. But lastRemoteVV was already
      // written (before the per-doc loop), so pushOnly is not stranded on cold start.
      fetchUpdates: () => Promise.reject(new Error("relay blip")),
      sendUpdates: () => Promise.resolve(),
      directedFetchUpdates: () => Promise.reject(new Error("relay blip")),
      peers: () => inner.peers(),
    };
    const sm = new SyncExchange(aStore, throwing, new NoopWorkspaceLock());
    await expect(sm.sync()).rejects.toThrow(/relay blip/);

    // pushOnly proceeds (cache populated by the partial round) and pushes A's docs.
    const r = await sm.pushOnly();
    expect(r.pushed).toBeGreaterThan(0);
  });
});

describe("Engine.importUpdate — merge-path termination (no re-export pump)", () => {
  it("re-importing already-known bytes is a no-op: produces no effects, advances no VV", async () => {
    // CRDT merge itself is Loro's job (in-version ops apply idempotently); this locks in that our
    // integration doesn't turn import into a re-export pump. The load-bearing assertion is that
    // import produces no effects: a committed fact (what PushFastPath listens for) is derived ONLY
    // from captureEffects around LOCAL mutators, and import bypasses mutators entirely — so a
    // received update can never re-trigger a push:
    //   recv → import → (no effects) → no committed fact → no schedulePush (halts).
    // Guards against someone later wiring import into the effect channel.
    const aStore = newStore();
    const aEngine = new Engine({ store: aStore });
    await aEngine.createNode(null); // dirties the treeDoc ("main")
    const bStore = newStore();
    const { transport } = recording(bStore);
    await new SyncExchange(aStore, transport, new NoopWorkspaceLock()).sync(); // A ↔ B converge; A holds both peers' treeDoc ops

    // A's full treeDoc update (every op A holds), fed straight back into A via the composite's tree
    // SyncableDoc — the surface sync/persist use (Engine no longer exposes export/import).
    const treeDoc = aStore.treeSyncDoc();
    const aBytes = await treeDoc.exportUpdate();
    expect(aBytes.length).toBeGreaterThan(0); // non-empty so the no-op below is meaningful

    const vvBefore = await treeDoc.version();
    const { effects } = await aEngine.captureEffects(() => treeDoc.importUpdate(aBytes));
    const vvAfter = await treeDoc.version();

    expect(effects).toEqual([]); // import emits no effects → nothing re-triggers a push
    // CRDT applies in-version ops idempotently → the opaque version bytes are unchanged.
    expect(Buffer.from(vvAfter).equals(Buffer.from(vvBefore))).toBe(true);
  });
});

describe("InMemorySyncTransport — directed fetch + peers (the mockable bootstrap seam)", () => {
  it("reports the remote peerId and directed-fetches a doc by it — no broker required", async () => {
    // The directed-membership-bootstrap path (registry.directedMembershipFetch) can be exercised
    // against an in-memory transport now that peers()/directedFetchUpdates are on the SyncTransport
    // seam — this is the payoff: a broker-free mock.
    const bStore = newStore();
    await new Engine({ store: bStore }).createNode(null); // B has a dirty tree doc
    const treeId = bStore.treeSyncDoc().id;
    // The joiner's version of the doc — a fresh store's encoded empty version vector. A raw
    // zero-length array is NOT a valid Loro VV; the joiner passes its real (empty) version, as prod does.
    const fromEmpty = await newStore().treeSyncDoc().version();

    const transport = new InMemorySyncTransport(bStore, "peer-b");

    // peers() lists the remote's declared peerId (the caller filters self; self is empty here).
    expect(await transport.peers()).toEqual(["peer-b"]);
    // A transport with no declared peerId reports nobody (the plain syncPair shape).
    expect(await new InMemorySyncTransport(bStore).peers()).toEqual([]);

    // Directed fetch from "peer-b" returns the tree doc's bytes beyond the (empty) version — the
    // same flow the joiner's directedMembershipFetch runs against the broker in production.
    const bytes = await transport.directedFetchUpdates(treeId, fromEmpty, "peer-b");
    expect(bytes.length).toBeGreaterThan(0);
  });
});

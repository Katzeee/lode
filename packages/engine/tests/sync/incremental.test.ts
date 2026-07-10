import { describe, expect, it } from "vitest";
import { Engine } from "../../src/core/engine.js";
import { ShardedBlockStore } from "../../src/core/store/sharded-store.js";
import { InMemorySyncTransport, SyncExchange } from "../../src/runtime/sync/sync-exchange.js";
import { canonical } from "./harness.js";

/**
 * Phase 6 — incremental sync via the per-peer revision cursor. After a full round establishes the
 * cursor, a subsequent round CONSIDERS (exchanges) only shards whose revision advanced (local
 * change) or whose peer version changed — not every owned shard. Measured as `considered` (docs the
 * driver exchanged). The cursor lives on the (reused) SyncExchange — production reuses it per peer.
 */
describe("incremental sync (Phase 6): a round only considers changed shards", () => {
  it("after M shard changes, the next round considers ≈ M shards (not all owned)", async () => {
    const numShards = 256;
    const a = new ShardedBlockStore({ numShards, capacity: 2 });
    const eA = new Engine({ store: a });
    const b = new ShardedBlockStore({ numShards, capacity: 2 });
    const eB = new Engine({ store: b });

    // 24 nodes on A (fanned across many shards).
    const nodes = [];
    for (let i = 0; i < 24; i++) {
      nodes.push(await eA.createNode(null));
    }
    eA.captureSync();

    // One long-lived SyncExchange — the cursor persists across rounds (production reuses it per peer).
    const sm = new SyncExchange(a, new InMemorySyncTransport(b));
    const r1 = await sm.sync(); // round 1: full — every owned doc is a first-round candidate
    await b.heal();
    await expect(canonical(eA)).resolves.toEqual(await canonical(eB)); // converged
    expect(r1.considered).toBeGreaterThan(20); // round 1 considered (almost) all owned shards

    // Change M=3 nodes on A.
    for (const n of nodes.slice(0, 3)) {
      await eA.replaceDeltas(n.occurrenceId, [{ insert: "changed" }]);
    }
    eA.captureSync();

    const r2 = await sm.sync(); // round 2: incremental (cursor active)
    await b.heal();
    await expect(canonical(eA)).resolves.toEqual(await canonical(eB)); // still converged
    // Round 2 considered only the changed shards + the tree (always a candidate) — far fewer than
    // round 1's full scan, and ≈ the M=3 changed set, not the 24 owned shards.
    expect(r2.considered).toBeLessThan(r1.considered);
    expect(r2.considered).toBeLessThanOrEqual(5); // ≈ changed(3) + tree + small slack
  });
});

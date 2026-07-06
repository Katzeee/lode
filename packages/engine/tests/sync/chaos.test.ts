import { describe, expect, it } from "vitest";
import { createPlainNode } from "../../src/domain/node.js";
import { syncPair } from "../../src/runtime/sync/sync-manager.js";
import {
  assertConverged,
  canonical,
  cloneReplica,
  replica,
  syncAll,
  syncTreeOnly,
} from "./harness.js";

/**
 * Sync chaos/partition TRUTH. The sync layer is treated as unreliable: it may deliver only the
 * treeDoc (shards pending), isolate a replica, or re-deliver. The truth asserted (independent of
 * any implementation): faults never corrupt permanently — after a full re-sync the replicas
 * converge to one valid state, and re-syncing is a no-op.
 */
describe("sync chaos: partial delivery + partition heal", () => {
  it("treeDoc-only partial delivery does not corrupt; full sync heals to convergence", async () => {
    const a = replica(8);
    const root = createPlainNode(a, null);
    const n = createPlainNode(a, root.occurrenceId);
    a.replaceDeltas(n.occurrenceId, [{ insert: "in shard" }]);
    const b = cloneReplica(a);
    const added = createPlainNode(a, root.occurrenceId); // A adds a node whose entity is in a shard

    syncTreeOnly(a, b); // structure reaches B; A's new shard content does NOT
    // Truth: a partial exchange must not crash. (B may temporarily reference an undelivered
    // entity — that's the incomplete state a heal fixes.)
    // Full heal:
    await syncPair(a.getShardedStore()!, b.getShardedStore()!);
    assertConverged([a, b], "partial → full heal");
    expect(b.getOccurrence(added.occurrenceId)).toBeDefined(); // A's added node reached B
  });

  it("partitioned replica reconnects and converges (no data loss)", async () => {
    const base = replica(8);
    const root = createPlainNode(base, null);
    const a = cloneReplica(base);
    const b = cloneReplica(base);
    const c = cloneReplica(base);

    // A↔B converge while C is partitioned (diverges on its own).
    await syncPair(a.getShardedStore()!, b.getShardedStore()!);
    const onC = createPlainNode(c, root.occurrenceId);
    const onA = createPlainNode(a, root.occurrenceId);

    // C reconnects.
    await syncAll([a, b, c]);
    assertConverged([a, b, c], "partition heal");
    // Conservation: both partition-time creates survived the heal on every replica.
    for (const e of [a, b, c]) {
      expect(e.getOccurrence(onC.occurrenceId)).toBeDefined();
      expect(e.getOccurrence(onA.occurrenceId)).toBeDefined();
    }
  });

  it("re-delivery is idempotent: syncing again changes nothing", async () => {
    const a = replica(8);
    const root = createPlainNode(a, null);
    createPlainNode(a, root.occurrenceId);
    const b = cloneReplica(a);
    createPlainNode(b, root.occurrenceId);

    await syncPair(a.getShardedStore()!, b.getShardedStore()!);
    const after = canonical(a);
    await syncPair(a.getShardedStore()!, b.getShardedStore()!);
    await syncPair(a.getShardedStore()!, b.getShardedStore()!);
    expect(canonical(a)).toBe(after);
    expect(canonical(b)).toBe(after);
    assertConverged([a, b], "re-delivery");
  });
});

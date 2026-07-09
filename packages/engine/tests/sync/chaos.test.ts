import { describe, expect, it } from "vitest";
import { createPlainNode } from "../../src/domain/node/node.js";
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
    const root = await a.createNode(null);
    const n = await createPlainNode(a, root.occurrenceId);
    await a.replaceDeltas(n.occurrenceId, [{ insert: "in shard" }]);
    const b = await cloneReplica(a);
    const added = await createPlainNode(a, root.occurrenceId); // A adds a node whose entity is in a shard

    await syncTreeOnly(a, b); // structure reaches B; A's new shard content does NOT
    // Truth: a partial exchange must not crash. (B may temporarily reference an undelivered
    // entity — that's the incomplete state a heal fixes.)
    // Full heal:
    await syncPair(a.asOutliner(), b.asOutliner());
    await assertConverged([a, b], "partial → full heal");
    expect(await b.getOccurrence(added.occurrenceId)).toBeDefined(); // A's added node reached B
  });

  it("partitioned replica reconnects and converges (no data loss)", async () => {
    const base = replica(8);
    const root = await base.createNode(null);
    const a = await cloneReplica(base);
    const b = await cloneReplica(base);
    const c = await cloneReplica(base);

    // A↔B converge while C is partitioned (diverges on its own).
    await syncPair(a.asOutliner(), b.asOutliner());
    const onC = await createPlainNode(c, root.occurrenceId);
    const onA = await createPlainNode(a, root.occurrenceId);

    // C reconnects.
    await syncAll([a, b, c]);
    await assertConverged([a, b, c], "partition heal");
    // Conservation: both partition-time creates survived the heal on every replica.
    for (const e of [a, b, c]) {
      expect(await e.getOccurrence(onC.occurrenceId)).toBeDefined();
      expect(await e.getOccurrence(onA.occurrenceId)).toBeDefined();
    }
  });

  it("re-delivery is idempotent: syncing again changes nothing", async () => {
    const a = replica(8);
    const root = await a.createNode(null);
    await createPlainNode(a, root.occurrenceId);
    const b = await cloneReplica(a);
    await createPlainNode(b, root.occurrenceId);

    await syncPair(a.asOutliner(), b.asOutliner());
    const after = await canonical(a);
    await syncPair(a.asOutliner(), b.asOutliner());
    await syncPair(a.asOutliner(), b.asOutliner());
    expect(await canonical(a)).toBe(after);
    expect(await canonical(b)).toBe(after);
    await assertConverged([a, b], "re-delivery");
  });
});

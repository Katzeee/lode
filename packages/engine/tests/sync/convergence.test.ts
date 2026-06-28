import { describe, expect, it } from "vitest";
import { mulberry32 } from "../driver.js";
import { createPlainNode } from "../../src/domain/node.js";
import { assertConverged, cloneReplica, replica, syncAll } from "./harness.js";

/**
 * Convergence fuzz TRUTH. Random replica counts (2–4) and per-replica node counts, each replica
 * creating + editing INDEPENDENT root nodes, then syncAll. Truth asserted (independent of any
 * implementation): every replica converges to one valid state, and every created node is
 * conserved on every replica (no op lost). Interacting-op pairs are covered exhaustively in
 * op-pairs.test.ts; CRDT convergence is transitive (pairwise ⟹ global), so this fuzz targets
 * N-replica transitivity + conservation over varied sizes/topologies.
 */
describe("sync convergence fuzz", () => {
  it("independent replicas: converge + every created node conserved on all", async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rng = mulberry32(seed * 99);
      const numReplicas = 2 + Math.floor(rng() * 3); // 2–4
      const replicas = [];
      const created: string[] = [];
      for (let r = 0; r < numReplicas; r++) {
        const e = replica(8);
        const k = 1 + Math.floor(rng() * 4); // 1–4 nodes per replica
        for (let i = 0; i < k; i++) {
          const n = createPlainNode(e, null);
          e.replaceDeltas(n.occurrenceId, [{ insert: `r${r}-n${i}` }]);
          created.push(n.occurrenceId);
        }
        replicas.push(e);
      }
      await syncAll(replicas);
      assertConverged(replicas, `seed ${seed}`);
      for (const e of replicas) {
        for (const occ of created) {
          expect(e.getOccurrence(occ)).toBeDefined();
        }
      }
    }
  });

  it("shared base + N divergent replicas: converge + base state preserved on all", async () => {
    for (const seed of [10, 11, 12]) {
      const rng = mulberry32(seed * 7);
      const base = replica(8);
      const root = createPlainNode(base, null);
      const baseChild = createPlainNode(base, root.occurrenceId);

      const n = 2 + Math.floor(rng() * 3); // 2–4 divergent replicas
      const replicas = [cloneReplica(base)];
      for (let r = 1; r < n; r++) {
        const e = cloneReplica(base);
        createPlainNode(e, root.occurrenceId); // each diverges with an independent create
        replicas.push(e);
      }
      await syncAll(replicas);
      assertConverged(replicas, `seed ${seed}`);
      // base state (root + baseChild) preserved on every replica; each divergence present on all
      for (const e of replicas) {
        expect(e.getOccurrence(root.occurrenceId)).toBeDefined();
        expect(e.getOccurrence(baseChild.occurrenceId)).toBeDefined();
      }
      // root has baseChild + (n-1) divergent creates
      expect(replicas[0]?.getChildOccurrenceIds(root.occurrenceId)).toHaveLength(n);
    }
  });
});

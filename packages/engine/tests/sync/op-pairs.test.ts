import { describe, it } from "vitest";
import type { Engine } from "../../src/core/engine.js";
import {
  createPlainNode,
  createReference,
  hardDeleteNode,
  moveOccurrence,
} from "../../src/domain/node/node.js";
import { syncPair } from "../../src/runtime/sync/sync-manager.js";
import { assertConverged, cloneReplica, replica } from "./harness.js";

/**
 * Exhaustive concurrent op-pair TRUTH. For EVERY pair (opA, opB) over a shared base, two
 * replicas each apply one op concurrently, sync, and must converge to one valid state. This is
 * the strongest interacting-ops coverage: it provably enumerates the whole op-pair space for the
 * base. Moves are restricted to `x → root` (never "under a deletable node"): the concurrent
 * move-into-a-deleted-subtree combination is a cascade-delete semantic outcome (the moved node
 * is removed with the deleted subtree), not a convergence bug — it is pinned explicitly in
 * truth.test.ts ("move under a concurrently-deleted node").
 */

// Shared base: root → {x, y}. Built once; each test clones it (ids preserved across clones).
const base = replica(8);
const rootOcc = (await base.createNode(null)).occurrenceId;
const x = await createPlainNode(base, rootOcc);
const y = await createPlainNode(base, rootOcc);
const xOcc = x.occurrenceId;
const xNode = x.nodeId;
const yOcc = y.occurrenceId;
const yNode = y.nodeId;

type Op = { name: string; apply: (e: Engine) => Promise<unknown> };

const OPS: Op[] = [
  { name: "create", apply: (e) => createPlainNode(e, rootOcc) },
  { name: "editX", apply: (e) => e.replaceDeltas(xOcc, [{ insert: "a" }]) },
  { name: "editY", apply: (e) => e.replaceDeltas(yOcc, [{ insert: "b" }]) },
  { name: "moveXunderY", apply: (e) => moveOccurrence(e, xOcc, yOcc) },
  { name: "setPropX", apply: (e) => e.setProp(xOcc, "k", "v") },
  { name: "deleteX", apply: (e) => hardDeleteNode(e, xNode) },
  { name: "deleteY", apply: (e) => hardDeleteNode(e, yNode) },
  { name: "refX", apply: (e) => createReference(e, xNode, rootOcc) },
];

describe("sync exhaustive concurrent op-pairs (every pair converges to a valid equal state)", () => {
  for (const opA of OPS) {
    for (const opB of OPS) {
      it(`${opA.name} ∥ ${opB.name}`, async () => {
        const a = await cloneReplica(base);
        const b = await cloneReplica(base);
        await opA.apply(a);
        await opB.apply(b);
        await syncPair(a.asOutliner(), b.asOutliner());
        await assertConverged([a, b], `${opA.name} ∥ ${opB.name}`);
      });
    }
  }
});

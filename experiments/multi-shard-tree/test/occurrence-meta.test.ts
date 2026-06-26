import { describe, expect, it } from "vitest";
import { ShardedEngine } from "../src/sharded-engine.js";
import { SingleDocEngine } from "../src/single-doc-engine.js";
import { cloneReplica, syncReplicas } from "../src/simulator.js";

/**
 * Finding 3 — per-occurrence `meta` (production's managed-child provenance).
 *
 * Production stamps a `meta` LoroMap on every occurrence tree node
 * (`createOccurrenceRecord`), living in the treeDoc. `managed-child-state.ts` reads
 * `managedKind` + `managedBySchemas` (an array of `{schemaId, schemaChildNodeId,
 * schemaChildOccurrenceId}`) from occurrence meta — and `schemaChildOccurrenceId` is
 * an OCCURRENCE id (stable across moves, churns across delete/recreate). The
 * prototype previously modeled NONE of this, so it could not validate that sharding
 * preserves occurrence-level relationship data. The engines now stamp occurrence
 * meta (production-faithful) and expose it; these tests verify the treeDoc carries
 * it correctly through sync + structural ops.
 */

const canon = (e: ShardedEngine | SingleDocEngine, n: string): string =>
  e.snapshot().nodes[n]!.canonicalOccurrenceId;

/** Production-shaped managed-child provenance. */
const provenance = (schemaId: string, childOccId: string): unknown => ({
  managedKind: "fieldSlot",
  managedBySchemas: [
    { schemaId, schemaChildNodeId: `field-${schemaId}`, schemaChildOccurrenceId: childOccId },
  ],
});

describe("occurrence meta: syncs across replicas (treeDoc carries it)", () => {
  it("managed-child provenance written on A arrives identically on B after sync", () => {
    const a = new ShardedEngine(8);
    const root = a.createNode("root", null);
    const schema = a.createNode("S", root);
    const slot = a.createNode("slot", schema);
    a.setOccurrenceMeta(slot, "managedChild", provenance("S", canon(a, "slot")));
    a.commit();

    const b = new ShardedEngine(8);
    syncReplicas(a, b);

    // B's slot occurrence is a different TreeID than A's (synced tree), but the
    // meta value is identical — including the nested array of objects.
    const bSlot = canon(b, "slot");
    expect(b.getOccurrenceMeta(bSlot, "managedChild")).toEqual(provenance("S", canon(a, "slot")));
    b.validateInvariants();
  });

  it("differential: sharded ≡ oracle for occurrence meta after identical ops", () => {
    // Use a fixed (non-opaque) child occurrence id in the value: opaque TreeIDs
    // differ across engines by design, so the equivalence is on the meta-carrying
    // machinery, not on id minting.
    const run = (Eng: new () => ShardedEngine | SingleDocEngine): unknown => {
      const e = new Eng();
      const root = e.createNode("root", null);
      const x = e.createNode("x", root);
      e.setOccurrenceMeta(x, "managedChild", provenance("S", "childOcc-fixed"));
      e.commit();
      return e.getOccurrenceMeta(canon(e, "x"), "managedChild");
    };
    expect(run(ShardedEngine as never)).toEqual(run(SingleDocEngine as never));
  });

  it("occurrence meta is PER-OCCURRENCE (two occurrences of one node differ)", () => {
    const e = new ShardedEngine(8);
    const root = e.createNode("root", null);
    const o1 = e.createNode("x", root);
    const o2 = e.createReference("x", root); // second occurrence of x
    e.setOccurrenceMeta(o1, "managedChild", provenance("S1", o1));
    e.setOccurrenceMeta(o2, "managedChild", provenance("S2", o2));
    e.commit();
    expect(e.getOccurrenceMeta(o1, "managedChild")).toEqual(provenance("S1", o1));
    expect(e.getOccurrenceMeta(o2, "managedChild")).toEqual(provenance("S2", o2));
    // The two occurrences of the same node carry independent meta.
    expect(e.getOccurrenceMeta(o1, "managedChild")).not.toEqual(
      e.getOccurrenceMeta(o2, "managedChild"),
    );
  });
});

describe("occurrence meta: survives structural ops", () => {
  it("meta travels with the occurrence across a MOVE (occurrence id is move-stable)", () => {
    const a = new ShardedEngine(8);
    const root = a.createNode("root", null);
    const x = a.createNode("x", root);
    a.setOccurrenceMeta(x, "managedChild", provenance("S", x));
    a.commit();
    const before = a.getOccurrenceMeta(x, "managedChild");

    // Move x's occurrence to a new parent; the occurrence id is unchanged (Loro
    // movable-tree TreeID persists across moves), so the meta — and the
    // occurrence-id reference inside it — stays valid.
    const y = a.createNode("y", root);
    a.moveOccurrence(x, y);
    a.commit();
    expect(a.getOccurrenceMeta(x, "managedChild")).toEqual(before);
    a.validateInvariants();
  });

  it("meta written on A, then A moves the occurrence, then sync → B sees meta + move", () => {
    const a = new ShardedEngine(8);
    const root = a.createNode("root", null);
    const x = a.createNode("x", root);
    a.setOccurrenceMeta(x, "managedChild", provenance("S", x));
    const y = a.createNode("y", root);
    a.moveOccurrence(x, y);
    a.commit();

    const b = new ShardedEngine(8);
    syncReplicas(a, b);
    expect(b.getOccurrenceMeta(canon(b, "x"), "managedChild")).toEqual(provenance("S", x));
    expect(b.snapshot().occurrences[canon(b, "x")]?.parentOccurrenceId).toBe(canon(b, "y"));
  });
});

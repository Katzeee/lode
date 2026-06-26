import { describe, expect, it } from "vitest";
import { ShardedEngine } from "../src/sharded-engine.js";
import { SingleDocEngine } from "../src/single-doc-engine.js";
import { canonicalStructure, stableStringify } from "../src/compare.js";
import { cloneReplica, syncAll } from "../src/simulator.js";
import {
  assertHardDeleteAllowed,
  fieldSlots,
  reconcileSchema,
  schemaFields,
  slotCountForField,
} from "../src/domain.js";
import type { OutlineApi } from "../src/types.js";

const canon = (e: OutlineApi, nodeId: string): string => {
  const id = e.snapshot().nodes[nodeId]?.canonicalOccurrenceId;
  if (!id) throw new Error(`no canonical for ${nodeId}`);
  return id;
};

/** Build root + a schema node `S` whose fields prop = the given comma list. */
const seedSchema = (fields: string): ShardedEngine => {
  const e = new ShardedEngine(4);
  e.createNode("root", null);
  e.createNode("S", canon(e, "root"));
  e.setEntityProp("S", "fields", fields);
  e.commit();
  return e;
};

/** Create a field-slot child under S's canonical occurrence. */
const addSlot = (e: ShardedEngine, slotNodeId: string, fieldDef: string): void => {
  e.createNode(slotNodeId, canon(e, "S"));
  e.setEntityProp(slotNodeId, "fieldDef", fieldDef);
  e.commit();
};

/**
 * D1 — the headline domain property. Two replicas concurrently add a field slot
 * for the SAME schema field. The engine merge yields TWO slots (structurally
 * valid, semantically wrong). Domain reconcile collapses them to exactly one,
 * and the choice is deterministic (min nodeId) so both replicas agree.
 */
describe("D1 reconcile: concurrent schema-add yields exactly one field", () => {
  it("two replicas each add the f1 slot → reconcile collapses to one, converges", () => {
    const seed = seedSchema("f1");
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);

    addSlot(a, "slotA", "f1");
    addSlot(b, "slotB", "f1");

    syncAll([a, b]);
    // Duplicated state — structurally valid, domain-incorrect.
    expect(slotCountForField(a, "S", "f1")).toBe(2);
    expect(slotCountForField(b, "S", "f1")).toBe(2);

    reconcileSchema(a, "S");
    reconcileSchema(b, "S");
    syncAll([a, b]);

    a.validateInvariants();
    b.validateInvariants();
    expect(slotCountForField(a, "S", "f1")).toBe(1);
    expect(slotCountForField(b, "S", "f1")).toBe(1);
    expect(stableStringify(canonicalStructure(a.snapshot()))).toBe(
      stableStringify(canonicalStructure(b.snapshot())),
    );
    // The survivor is deterministic: min(slotA, slotB) = slotA.
    expect(a.snapshot().nodes["slotA"]).toBeDefined();
    expect(a.snapshot().nodes["slotB"]).toBeUndefined();
  });

  it("the same reconcile logic runs on the single-doc oracle (engine-agnostic)", () => {
    // The domain layer depends only on OutlineApi, so it works on the oracle too.
    const e = new SingleDocEngine();
    e.createNode("root", null);
    e.createNode("S", canon(e, "root"));
    e.setEntityProp("S", "fields", "f1");
    e.createNode("s1", canon(e, "S"));
    e.setEntityProp("s1", "fieldDef", "f1");
    e.createNode("s2", canon(e, "S"));
    e.setEntityProp("s2", "fieldDef", "f1");
    e.commit();
    expect(slotCountForField(e, "S", "f1")).toBe(2);
    reconcileSchema(e, "S");
    expect(slotCountForField(e, "S", "f1")).toBe(1);
    e.validateInvariants();
  });
});

describe("D2 reconcile is idempotent", () => {
  it("running reconcile a second time changes nothing", () => {
    const e = seedSchema("f1,f2");
    addSlot(e, "s1", "f1");
    addSlot(e, "s2", "f1"); // duplicate
    addSlot(e, "s3", "f2");
    reconcileSchema(e, "S");
    const after1 = stableStringify(canonicalStructure(e.snapshot()));
    reconcileSchema(e, "S");
    const after2 = stableStringify(canonicalStructure(e.snapshot()));
    expect(after1).toBe(after2);
    expect(slotCountForField(e, "S", "f1")).toBe(1);
    expect(slotCountForField(e, "S", "f2")).toBe(1);
  });
});

describe("D3 reconcile is order-independent across replicas", () => {
  it("reconcile-then-sync == sync-then-reconcile", () => {
    const mk = (): { a: ShardedEngine; b: ShardedEngine } => {
      const seed = seedSchema("f1");
      const a = cloneReplica(seed);
      const b = cloneReplica(seed);
      addSlot(a, "slotA", "f1");
      addSlot(b, "slotB", "f1");
      return { a, b };
    };

    // Path 1: reconcile both, then sync, then a final reconcile+sync.
    // (Reconcile before sync can't dedup a replica's own slot it hasn't seen
    // paired with; the cross-replica duplicate only appears after sync, so a
    // post-sync reconcile is required — reconcile is eventually-correct.)
    const p1 = mk();
    reconcileSchema(p1.a, "S");
    reconcileSchema(p1.b, "S");
    syncAll([p1.a, p1.b]);
    reconcileSchema(p1.a, "S");
    reconcileSchema(p1.b, "S");
    syncAll([p1.a, p1.b]);

    // Path 2: sync first (both see both slots), then reconcile, then sync.
    const p2 = mk();
    syncAll([p2.a, p2.b]);
    reconcileSchema(p2.a, "S");
    reconcileSchema(p2.b, "S");
    syncAll([p2.a, p2.b]);

    p1.a.validateInvariants();
    p2.a.validateInvariants();
    expect(stableStringify(canonicalStructure(p1.a.snapshot()))).toBe(
      stableStringify(canonicalStructure(p2.a.snapshot())),
    );
  });
});

describe("D4 reconcile is a pure function of state (deterministic)", () => {
  it("two identical states reconcile to the same result", () => {
    const seed = seedSchema("f1,f2");
    seed.createNode("dup1", canon(seed, "S"));
    seed.setEntityProp("dup1", "fieldDef", "f1");
    seed.createNode("dup2", canon(seed, "S"));
    seed.setEntityProp("dup2", "fieldDef", "f1");
    seed.commit();

    const a = cloneReplica(seed);
    const b = cloneReplica(seed);
    reconcileSchema(a, "S");
    reconcileSchema(b, "S");
    expect(stableStringify(canonicalStructure(a.snapshot()))).toBe(
      stableStringify(canonicalStructure(b.snapshot())),
    );
  });
});

describe("D5 managed children match the schema after reconcile", () => {
  it("prunes stale slots (field removed from schema) and dedups", () => {
    const e = seedSchema("f1"); // schema only has f1
    addSlot(e, "keep", "f1");
    addSlot(e, "dup", "f1");
    addSlot(e, "stale", "fGone"); // field no longer in schema
    reconcileSchema(e, "S");

    const defs = fieldSlots(e, "S").map((s) => s.fieldDef);
    expect(defs).toEqual(["f1"]); // stale pruned, dup collapsed
    expect(e.snapshot().nodes["stale"]).toBeUndefined();
  });
});

describe("D6 policy: schema nodes are protected from hard-delete", () => {
  it("throws when hard-deleting a schema node; allows ordinary nodes", () => {
    const e = seedSchema("f1");
    addSlot(e, "slot", "f1");
    expect(() => assertHardDeleteAllowed(e, "S")).toThrow();
    expect(() => assertHardDeleteAllowed(e, "slot")).not.toThrow();
    // Schema fields are still readable.
    expect(schemaFields(e, "S")).toEqual(["f1"]);
  });
});

describe("D7 schema change propagates: removed field's slot is pruned", () => {
  it("dropping a field from the schema then reconciling removes its slot", () => {
    const seed = seedSchema("f1,f2");
    addSlot(seed, "s1", "f1");
    addSlot(seed, "s2", "f2");
    const a = cloneReplica(seed);
    const b = cloneReplica(seed);

    // Replica A removes f2 from the schema definition.
    a.setEntityProp("S", "fields", "f1");
    a.commit();
    syncAll([a, b]);

    reconcileSchema(a, "S");
    reconcileSchema(b, "S");
    syncAll([a, b]);

    a.validateInvariants();
    b.validateInvariants();
    expect(slotCountForField(a, "S", "f2")).toBe(0);
    expect(slotCountForField(a, "S", "f1")).toBe(1);
    expect(stableStringify(canonicalStructure(a.snapshot()))).toBe(
      stableStringify(canonicalStructure(b.snapshot())),
    );
  });
});

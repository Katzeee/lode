import { describe, expect, it } from "vitest";
import { ShardedEngine } from "../src/sharded-engine.js";
import { mulberry32 } from "../src/driver.js";
import { canonicalStructure, stableStringify } from "../src/compare.js";
import { fieldSlots, reconcileSchema, validateDomainInvariants } from "../src/domain.js";

/**
 * #4 (invariants half) — domain semantics checked against an independent truth.
 *
 * The engine's structural validator only knows "this is a valid tree"; it cannot
 * see that a schema field is realized twice (two slots, both structurally valid,
 * semantically wrong). `reconcileSchema` is supposed to collapse such duplicates
 * — but it and the engine share assumptions, so a fuzz over random schema/slot
 * states asserting `validateDomainInvariants` (checked directly over the
 * snapshot, not derived from reconcile) is the independent witness.
 *
 * Model: schema node "S" carries a `fields` prop; a slot is a child of S's
 * canonical occurrence with a `fieldDef` prop. Fuzz seeds build random schemas
 * with duplicate and stale slots; reconcile must yield ≤1 slot per field and no
 * stale slots, idempotently, regardless of creation order.
 */

type SlotDef = { id: string; fieldDef: string };

function buildSchema(e: ShardedEngine, fields: string[], slotDefs: SlotDef[]): void {
  const sOcc = e.createNode("S", null);
  e.setEntityProp("S", "fields", fields.join(","));
  for (const s of slotDefs) {
    e.createNode(s.id, sOcc);
    e.setEntityProp(s.id, "fieldDef", s.fieldDef);
  }
  e.commit();
}

const survivorIds = (e: ShardedEngine): string[] =>
  fieldSlots(e, "S")
    .map((s) => s.nodeId)
    .sort();

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Deterministic random schema+slots state (with duplicates and stale slots). */
function randomState(rng: () => number): { fields: string[]; slotDefs: SlotDef[] } {
  const pool = ["f1", "f2", "f3", "f4"];
  const nFields = 1 + Math.floor(rng() * pool.length);
  const fields = pool.slice(0, nFields)!;
  const nSlots = Math.floor(rng() * 9);
  const slotDefs: SlotDef[] = [];
  for (let i = 0; i < nSlots; i++) {
    const stale = rng() < 0.2;
    const fd = stale ? "staleX" : fields[Math.floor(rng() * fields.length)]!;
    slotDefs.push({ id: `slot${i}`, fieldDef: fd });
  }
  return { fields, slotDefs };
}

describe("domain invariants: independent truth over random reconcile sequences", () => {
  it("the check is meaningful — duplicate slots violate it BEFORE reconcile", () => {
    const e = new ShardedEngine(4);
    buildSchema(
      e,
      ["f1", "f2"],
      [
        { id: "a", fieldDef: "f1" },
        { id: "b", fieldDef: "f1" }, // duplicate of f1
        { id: "c", fieldDef: "gone" }, // stale
      ],
    );
    expect(() => validateDomainInvariants(e)).toThrow();
    reconcileSchema(e, "S");
    expect(() => validateDomainInvariants(e)).not.toThrow();
    expect(survivorIds(e)).toEqual(["a"]); // min nodeId of the f1 pair wins; stale removed
  });

  it("after reconcile, ≤1 slot per field and no stale slots (200 fuzz seeds)", () => {
    for (let seed = 0; seed < 200; seed++) {
      const e = new ShardedEngine(4);
      const { fields, slotDefs } = randomState(mulberry32(seed + 99));
      buildSchema(e, fields, slotDefs);
      reconcileSchema(e, "S");
      expect(() => validateDomainInvariants(e)).not.toThrow();
    }
  });

  it("reconcile is idempotent — running it twice yields an identical state", () => {
    for (let seed = 0; seed < 200; seed++) {
      const e = new ShardedEngine(4);
      const { fields, slotDefs } = randomState(mulberry32(seed + 400));
      buildSchema(e, fields, slotDefs);
      reconcileSchema(e, "S");
      const once = stableStringify(canonicalStructure(e.snapshot()));
      reconcileSchema(e, "S");
      const twice = stableStringify(canonicalStructure(e.snapshot()));
      expect(twice).toBe(once);
    }
  });

  it("reconcile's decision is order-independent — same survivor set regardless of slot creation order", () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = mulberry32(seed + 700);
      const { fields, slotDefs } = randomState(rng);
      const e1 = new ShardedEngine(4);
      buildSchema(e1, fields, slotDefs);
      reconcileSchema(e1, "S");
      const e2 = new ShardedEngine(4);
      buildSchema(e2, fields, shuffle(slotDefs, mulberry32(seed + 701)));
      reconcileSchema(e2, "S");
      expect(survivorIds(e2)).toEqual(survivorIds(e1));
      validateDomainInvariants(e2);
    }
  });
});

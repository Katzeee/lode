import { describe, expect, it } from "vitest";
import { ShardedEngine } from "../src/sharded-engine.js";
import { SingleDocEngine } from "../src/single-doc-engine.js";
import { ActionHistory } from "../src/history.js";
import { canonicalStructure, stableStringify } from "../src/compare.js";

/**
 * #4 — canonical is MUTABLE in production (`promoteCanonicalOccurrence`,
 * domain/node.ts:44), but the prototype assumed set-once. These tests add the
 * engine primitive (`setCanonicalOccurrence`) and verify:
 *   - cascade correctness after a promote (which occurrence is canonical decides
 *     what "remove" does);
 *   - differential equivalence (sharded ≡ oracle) across a promote;
 *   - undo of a promote restores the prior canonical;
 *   - the hard case: undo of a hardDelete AFTER promote — diffToRestore's isCanon
 *     branch must still recreate the right nodes/occurrences even when the promoted
 *     canonical is positioned later in DFS than a reference to the same node.
 */

const canon = (e: ShardedEngine | SingleDocEngine | ActionHistory, nodeId: string): string => {
  const id = e.snapshot().nodes[nodeId]?.canonicalOccurrenceId;
  if (!id) throw new Error(`no canonical for ${nodeId}`);
  return id;
};

/** root → X (canonical O1) ; root → Y ; Y → ref-of-X (O2). X has 2 occurrences. */
function buildTwoOcc<S extends ShardedEngine | SingleDocEngine>(e: S): { xRefOcc: string } {
  const root = e.createNode("root", null, undefined, "R");
  e.createNode("X", root, undefined, "X-content"); // O1 = canonical of X, under root
  e.createNode("Y", root); // under root, after X
  const xRefOcc = e.createReference("X", canon(e, "Y")); // O2 = a reference to X, under Y
  e.commit();
  return { xRefOcc };
}

describe("canonical promote: cascade correctness", () => {
  it("removeOccurrence of the NEW canonical hard-deletes the node", () => {
    const e = new ShardedEngine(8);
    const { xRefOcc } = buildTwoOcc(e);
    e.setCanonicalOccurrence("X", xRefOcc); // promote O2 → canonical
    e.commit();
    expect(canon(e, "X")).toBe(xRefOcc);

    e.removeOccurrence(xRefOcc); // removing the (new) canonical → hard-delete X
    e.commit();
    e.validateInvariants();
    expect(e.existsNode("X")).toBe(false);
    expect(e.existsNode("Y")).toBe(true);
    expect(e.existsNode("root")).toBe(true);
  });

  it("removeOccurrence of the OLD (now non-canonical) occurrence removes only it", () => {
    const e = new ShardedEngine(8);
    const { xRefOcc } = buildTwoOcc(e);
    const occs = e.snapshot().nodes["X"]!.occurrences;
    const oldCanon = occs.find((o) => o !== xRefOcc)!; // O1, will become non-canonical
    e.setCanonicalOccurrence("X", xRefOcc); // promote O2 → canonical
    e.commit();

    e.removeOccurrence(oldCanon); // old canonical, now a plain reference → remove just it
    e.commit();
    e.validateInvariants();
    expect(e.existsNode("X")).toBe(true); // X survives via the promoted occurrence
    expect(e.snapshot().nodes["X"]!.occurrences.length).toBe(1);
    expect(canon(e, "X")).toBe(xRefOcc); // canonical unchanged by the removal
  });

  it("differential: sharded ≡ single-doc oracle across a promote + cascade", () => {
    const run = (Engine: new () => ShardedEngine | SingleDocEngine): string => {
      const e = new Engine();
      const { xRefOcc } = buildTwoOcc(e);
      e.setCanonicalOccurrence("X", xRefOcc);
      e.removeOccurrence(xRefOcc); // hard-delete via promoted canonical
      e.commit();
      e.validateInvariants();
      return stableStringify(canonicalStructure(e.snapshot()));
    };
    // Cast: both engines share the buildTwoOcc contract.
    const a = run(ShardedEngine as unknown as never);
    const b = run(SingleDocEngine as unknown as never);
    expect(a).toBe(b);
  });
});

describe("canonical promote: undo", () => {
  const newHist = (): { e: ShardedEngine; h: ActionHistory } => {
    const e = new ShardedEngine(8);
    return { e, h: new ActionHistory(e) };
  };

  it("undo of a promote restores the previous canonical", () => {
    const { e, h } = newHist();
    const { xRefOcc } = h.run((h) => buildTwoOcc(h) as never);
    const oldCanon = h.snapshot().nodes["X"]!.canonicalOccurrenceId;
    h.run((h) => h.setCanonicalOccurrence("X", xRefOcc));
    expect(canon(h, "X")).toBe(xRefOcc);

    h.undo();
    e.validateInvariants();
    expect(canon(h, "X")).toBe(oldCanon); // restored
  });

  it("undo of hardDelete AFTER promote fully restores (diffToRestore isCanon, cross-doc)", () => {
    // The promoted canonical (O2, under Y) is positioned AFTER the old canonical
    // (O1, under root) in DFS order. diffToRestore must recreate the node at O2
    // (createNode) and the occurrence at O1 (createReference) — and createNode must
    // come FIRST or createReference throws (entity missing). This is the case the
    // set-once-canonical assumption hid.
    const { e, h } = newHist();
    const { xRefOcc } = h.run((h) => buildTwoOcc(h) as never);
    h.run((h) => h.setCanonicalOccurrence("X", xRefOcc)); // canonical → O2 (deeper)
    const before = stableStringify(canonicalStructure(h.snapshot()));

    h.run((h) => h.hardDeleteNode("X")); // cascade removes O1 + O2 + entity
    e.validateInvariants();
    expect(e.existsNode("X")).toBe(false);

    expect(() => h.undo()).not.toThrow();
    e.validateInvariants();
    expect(stableStringify(canonicalStructure(h.snapshot()))).toBe(before);
    expect(e.snapshot().nodes["X"]?.text).toBe("X-content");
    expect(e.snapshot().nodes["X"]?.occurrences.length).toBe(2);
  });

  it("undo of removeOccurrence AFTER promote (non-canonical removal) restores it", () => {
    const { e, h } = newHist();
    const { xRefOcc } = h.run((h) => buildTwoOcc(h) as never);
    // Capture the occurrence that will become NON-canonical (O1) BEFORE promoting.
    const occs = h.snapshot().nodes["X"]!.occurrences;
    const o1 = occs.find((o) => o !== xRefOcc)!; // the original canonical, under root
    h.run((h) => h.setCanonicalOccurrence("X", xRefOcc)); // promote O2 → canonical
    const before = stableStringify(canonicalStructure(h.snapshot()));

    h.run((h) => h.removeOccurrence(o1)); // remove the non-canonical O1
    expect(e.snapshot().nodes["X"]?.occurrences.length).toBe(1);

    expect(() => h.undo()).not.toThrow();
    e.validateInvariants();
    expect(stableStringify(canonicalStructure(h.snapshot()))).toBe(before);
  });
});

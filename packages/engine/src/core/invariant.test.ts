import { describe, expect, it } from "vitest";
import { Engine } from "./engine.js";
import { validateSnapshot } from "./invariant.js";
import { toJSON } from "./serialize.js";
import type { DocSnapshot } from "./types.js";

/**
 * validateSnapshot — the structural-correctness contract. These tests confirm (a) the Engine
 * always produces a valid snapshot, and (b) the checker catches each violation class.
 */

const freshEngine = (): Engine => new Engine();

/** Build a minimal valid snapshot (root + one child) for mutation in negative cases. */
const validSnapshot = (): DocSnapshot => ({
  version: 4,
  entities: [
    { nodeId: "root", canonicalOccurrenceId: "o-root", deltas: [], props: {}, meta: {} },
    { nodeId: "child", canonicalOccurrenceId: "o-child", deltas: [], props: {}, meta: {} },
  ],
  occurrences: [
    {
      occurrenceId: "o-root",
      occId: "o-root",
      nodeId: "root",
      parentOccurrenceId: null,
      physicalChildOccurrenceIds: ["o-child"],
      occurrenceProps: {},
      occurrenceMeta: {},
    },
    {
      occurrenceId: "o-child",
      occId: "o-child",
      nodeId: "child",
      parentOccurrenceId: "o-root",
      physicalChildOccurrenceIds: [],
      occurrenceProps: {},
      occurrenceMeta: {},
    },
  ],
  rootOccurrenceIds: ["o-root"],
});

describe("validateSnapshot: the current single-doc Engine is always structurally valid", () => {
  it("an empty engine produces a valid (empty) snapshot", async () => {
    const snap = await toJSON(new Engine());
    expect(() => validateSnapshot(snap)).not.toThrow();
  });

  it("after a build with children + a transclusion, the snapshot validates", async () => {
    const e = freshEngine();
    const root = await e.createNode(null);
    await e.createNode(root.occurrenceId);
    await e.createOccurrence(root.nodeId, root.occurrenceId); // a second occurrence (transclusion) of root
    await e.setProp(root.occurrenceId, "kind", "page");
    const snap = await toJSON(e);
    expect(() => validateSnapshot(snap)).not.toThrow();
  });

  it("after moves and deletes, the snapshot still validates", async () => {
    const e = freshEngine();
    const root = await e.createNode(null);
    const a = await e.createNode(root.occurrenceId);
    const b = await e.createNode(root.occurrenceId);
    await e.moveOccurrence(b.occurrenceId, a.occurrenceId); // b under a
    let snap = await toJSON(e);
    expect(() => validateSnapshot(snap)).not.toThrow();
    await e.deleteNode(b.nodeId); // core removeOccurrence throws on canonical; deleteNode removes the node
    snap = await toJSON(e);
    expect(() => validateSnapshot(snap)).not.toThrow();
  });
});

describe("validateSnapshot: catches every structural violation", () => {
  /** Find an occurrence by id in a snapshot (test setup; throws if absent). */
  const occ = (snap: DocSnapshot, id: string) => {
    const o = snap.occurrences.find((x) => x.occurrenceId === id);
    if (!o) {
      throw new Error(`test setup: occurrence ${id} missing`);
    }
    return o;
  };
  /** Find an entity by nodeId in a snapshot (test setup; throws if absent). */
  const entity = (snap: DocSnapshot, nodeId: string) => {
    const e = snap.entities.find((x) => x.nodeId === nodeId);
    if (!e) {
      throw new Error(`test setup: entity ${nodeId} missing`);
    }
    return e;
  };

  it("root with a parent", () => {
    const s = validSnapshot();
    occ(s, "o-root").parentOccurrenceId = "o-child";
    expect(() => validateSnapshot(s)).toThrow(/Root .* has parent/);
  });

  it("occurrence referencing a missing entity", () => {
    const s = validSnapshot();
    occ(s, "o-child").nodeId = "ghost";
    expect(() => validateSnapshot(s)).toThrow(/references missing node ghost/);
  });

  it("child whose parent pointer does not match", () => {
    const s = validSnapshot();
    occ(s, "o-child").parentOccurrenceId = null;
    expect(() => validateSnapshot(s)).toThrow(/Child .* parent is/);
  });

  it("a cycle", () => {
    const s = validSnapshot();
    // root -> child -> root (make child a child of itself via a second occurrence is
    // hard to construct validly; instead make a 2-root mutual cycle).
    s.occurrences = [
      {
        occurrenceId: "o-a",
        occId: "o-a",
        nodeId: "root",
        parentOccurrenceId: "o-b",
        physicalChildOccurrenceIds: [],
        occurrenceProps: {},
        occurrenceMeta: {},
      },
      {
        occurrenceId: "o-b",
        occId: "o-b",
        nodeId: "child",
        parentOccurrenceId: "o-a",
        physicalChildOccurrenceIds: [],
        occurrenceProps: {},
        occurrenceMeta: {},
      },
    ];
    s.rootOccurrenceIds = [];
    expect(() => validateSnapshot(s)).toThrow(/Detached|Cycle/);
  });

  it("a detached occurrence (unreachable from roots)", () => {
    const s = validSnapshot();
    s.occurrences.push({
      occurrenceId: "o-lost",
      occId: "o-lost",
      nodeId: "child",
      parentOccurrenceId: null,
      physicalChildOccurrenceIds: [],
      occurrenceProps: {},
      occurrenceMeta: {},
    });
    s.rootOccurrenceIds = ["o-root"]; // o-lost not reachable
    expect(() => validateSnapshot(s)).toThrow(/Detached occurrence o-lost/);
  });

  it("canonical not among the node's occurrences", () => {
    const s = validSnapshot();
    entity(s, "child").canonicalOccurrenceId = "o-root"; // child's canonical points at root's occ
    expect(() => validateSnapshot(s)).toThrow(
      /canonical .* not in its occurrences|does not point back/,
    );
  });

  it("an orphan entity (no occurrences — caught by the canonical check)", () => {
    const s = validSnapshot();
    s.entities.push({
      nodeId: "lonely",
      canonicalOccurrenceId: "o-x",
      deltas: [],
      props: {},
      meta: {},
    });
    expect(() => validateSnapshot(s)).toThrow(/Node lonely canonical o-x not in its occurrences/);
  });
});

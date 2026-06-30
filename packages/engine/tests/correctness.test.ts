import { describe, it, expect } from "vitest";
import { Engine } from "../src/core/engine.js";
import { ShardedBlockStore } from "../src/core/sharded-store.js";
import { toJSON } from "../src/core/serializers/json.js";
import { validateSnapshot } from "../src/core/invariant.js";
import { deltaToText } from "../src/core/delta/utils.js";
import type { DocSnapshot } from "../src/core/types.js";
import { applyOp, generateScript, mulberry32, type Op } from "./driver.js";
import {
  TruthModel,
  stableStringify,
  normalizeIntervals,
  MARK_KEY,
  MARK_VALUE,
  type ModelView,
} from "./truth-model.js";
import { counterGen } from "./equiv.js";

/**
 * Correctness fuzz — the (sharded) Engine must, after EVERY op, satisfy the TruthModel
 * (an oracle derived from the prose semantics, not from any store). This replaces the
 * old differential: "two engines agree" could not see a bug in the shared
 * Engine/Domain/Loro layer; "the engine matches the independent truth" can.
 *
 * Run across several shard counts (1, 2, 4, 8, 16) so fan-out is exercised. The engine
 * is paired with `counterGen()` (`"n0","n1",…`) which advances only on createNode, so
 * `nodeIdx === Number(nodeId.slice(1))` — that is how the engine's snapshot is projected
 * into the model's idx space. Occurrence ids are opaque and normalized out by projecting
 * both sides to DFS-position space.
 *
 * The fuzzer covers the FULL public mutator surface (every create/move/remove/delete,
 * canonical, text, mark/unmark, and every prop/meta set/unset at entity and occurrence
 * scope), so no public mutator lacks an independent witness.
 */

const SHARD_COUNTS = [1, 2, 4, 8, 16];
const RUNS = 60; // × shard counts, each op checked

/** Project an engine snapshot to the model's idx-space view (the independent read path
 *  — distinct snapshot fields per semantic concern, populated by distinct getters). */
function engineView(snap: DocSnapshot): ModelView {
  const idxOf = (nodeId: string): number => {
    const i = Number(nodeId.slice(1));
    if (!Number.isInteger(i)) {
      throw new Error(`unexpected nodeId (expected "n<int>"): ${nodeId}`);
    }
    return i;
  };
  const occById = new Map(snap.occurrences.map((o) => [o.occurrenceId, o]));
  const dfs: number[] = [];
  const occDataAtDfs: string[] = [];
  const dfsIndexOfOcc = new Map<string, number>();
  const visit = (occId: string): void => {
    if (dfsIndexOfOcc.has(occId)) {
      return;
    }
    const occ = occById.get(occId);
    if (!occ) {
      return;
    }
    dfsIndexOfOcc.set(occId, dfs.length);
    dfs.push(idxOf(occ.nodeId));
    occDataAtDfs.push(stableStringify({ props: occ.occurrenceProps, meta: occ.occurrenceMeta }));
    for (const c of occ.physicalChildOccurrenceIds) {
      visit(c);
    }
  };
  for (const r of snap.rootOccurrenceIds) {
    visit(r);
  }

  const occsByNode = new Map<string, number>();
  for (const o of snap.occurrences) {
    occsByNode.set(o.nodeId, (occsByNode.get(o.nodeId) ?? 0) + 1);
  }
  const nodes: ModelView["nodes"] = {};
  for (const e of snap.entities) {
    const idx = idxOf(e.nodeId);
    nodes[idx] = {
      text: deltaToText(e.deltas),
      props: stableStringify(e.props),
      entityMeta: stableStringify(e.meta),
      occurrenceCount: occsByNode.get(e.nodeId) ?? 0,
      canonicalDfsIndex: dfsIndexOfOcc.has(e.canonicalOccurrenceId)
        ? (dfsIndexOfOcc.get(e.canonicalOccurrenceId) ?? -1)
        : -1,
      marks: extractBoldIntervals(e.deltas),
    };
  }
  return { dfs, occDataAtDfs, nodes };
}

/** Bold [start,end) intervals present in a delta list, normalized (range-aware; the
 *  read path that makes mark/unmark correctness observable). */
function extractBoldIntervals(
  deltas: DocSnapshot["entities"][number]["deltas"],
): [number, number][] {
  const raw: [number, number][] = [];
  let pos = 0;
  for (const span of deltas) {
    const len = span.insert.length;
    if (span.attributes && span.attributes[MARK_KEY] === MARK_VALUE) {
      raw.push([pos, pos + len]);
    }
    pos += len;
  }
  return normalizeIntervals(raw);
}

/** Assert the engine's observable state equals the model's truth, after structural
 *  validation. Structure/content/props/meta/marks all compared via one string-equal
 *  projection (marks as normalized intervals, so unmark's range arithmetic is checked). */
function assertEngineMatchesTruth(engine: Engine, model: TruthModel, label: string): void {
  const snap = toJSON(engine);
  validateSnapshot(snap); // structural correctness contract (cycles, parent↔child, …)

  const engineViewStr = stableStringify(engineView(snap));
  const modelViewStr = stableStringify(model.project());
  if (engineViewStr !== modelViewStr) {
    throw new Error(
      `truth mismatch (${label})\n  engine: ${engineViewStr}\n  model:  ${modelViewStr}`,
    );
  }
}

/** Apply a script to one engine, asserting the independent truth after every op. */
function runTruth(ops: Op[], makeEngine: () => Engine, label: string): void {
  const e = makeEngine();
  const occIds: string[] = [];
  const nodeIds: string[] = [];
  const model = new TruthModel();
  for (const [i, op] of ops.entries()) {
    applyOp(e, op, occIds, nodeIds);
    model.step(op);
    assertEngineMatchesTruth(e, model, `${label} op#${i} ${op.t}`);
  }
  e.captureSync();
}

const HAND_WRITTEN: Op[] = [
  { t: "createNode", parent: null }, // occ0/node0 (root)
  { t: "createNode", parent: 0, props: { kind: "page" } }, // occ1/node1
  { t: "createNode", parent: 0 }, // occ2/node2
  { t: "createOccurrence", target: 1, parent: 0 }, // occ3 = 2nd occurrence of node1
  { t: "replaceDeltas", occ: 1, text: "hello" },
  { t: "mark", occ: 1, start: 0, end: 2 },
  { t: "unmark", occ: 1, start: 0, end: 1 }, // bold now on [1,2)
  { t: "setProp", occ: 1, key: "tag", val: "x" },
  { t: "setProps", occ: 1, props: { order: 1 } }, // merge
  { t: "unsetProp", occ: 1, key: "tag" },
  { t: "setEntityMeta", occ: 1, key: "src", val: "a" },
  { t: "unsetEntityMeta", occ: 1, key: "src" },
  { t: "setOccurrenceProp", occ: 1, key: "done", val: true },
  { t: "unsetOccurrenceProp", occ: 1, key: "done" },
  { t: "setOccurrenceMeta", occ: 1, key: "nid", val: 9 },
  { t: "unsetOccurrenceMeta", occ: 1, key: "nid" },
  { t: "setCanonicalOccurrence", node: 1, occ: 3 }, // promote occ3 → occ1 becomes removable
  { t: "remove", occ: 1 }, // occ1 is now a leaf, non-canonical
  { t: "move", occ: 2, parent: 3 }, // node2 under occ3
  { t: "deleteNode", node: 2 }, // occ2 is a leaf
];

const shardedEngine =
  (numShards: number): (() => Engine) =>
  () =>
    new Engine({ store: new ShardedBlockStore({ numShards }), nodeIdGenerator: counterGen() });

describe("correctness fuzz: the sharded Engine satisfies the independent truth", () => {
  it("a hand-written script across the full mutator surface matches the truth", () => {
    for (const ns of SHARD_COUNTS) {
      runTruth(HAND_WRITTEN, shardedEngine(ns), `sharded×${ns}`);
    }
  });

  it(`${RUNS} seeded random scripts — every op, all shard counts — match the truth`, () => {
    for (let seed = 0; seed < RUNS; seed++) {
      const rng = mulberry32(seed * 7919 + 13);
      const ops = generateScript(rng, 14 + (seed % 22));
      for (const ns of SHARD_COUNTS) {
        runTruth(ops, shardedEngine(ns), `sharded×${ns} seed=${seed}`);
      }
    }
  }, 600000);

  it("negative control: a stale model is caught (oracle is non-vacuous)", () => {
    // Apply the script to the engine but SKIP model.step on the replaceDeltas op, so
    // the model still believes node 1's text is "" while the engine has "hello". The
    // truth assertion MUST fire — proving the content check actually binds the engine.
    const e = shardedEngine(8)();
    const occIds: string[] = [];
    const nodeIds: string[] = [];
    const model = new TruthModel();
    let caught = false;
    for (const [i, op] of HAND_WRITTEN.entries()) {
      applyOp(e, op, occIds, nodeIds);
      if (op.t !== "replaceDeltas") {
        model.step(op);
      }
      try {
        assertEngineMatchesTruth(e, model, `neg op#${i}`);
      } catch {
        caught = true;
        break;
      }
    }
    expect(caught).toBe(true);
  });

  // Snapshot-diff undo (occId-keyed before/after per changed occurrence/entity) is exact
  // under multi-occurrence transclusion and delete/recreate churn — the systemic issue
  // that kept this test red under the old node-stable command-inverse descriptors is
  // fixed. This fuzz has earned its keep across the undo mechanism's life: it found four
  // real bugs (createOccurrence undo no-op, root-index-always-zero, self-transclusion
  // cycle crash, and the node-stable move-index mismatch), all now resolved.
  it(`${RUNS} seeded undoable scripts — undo reverts each op, redo restores it, invariants hold`, () => {
    // Undo/redo is a sharded-only contract (single-doc redo is a known loro limitation).
    // For every undoable-only script: capture state after each op, then undo back to the
    // initial state and redo forward — each step must match the captured snapshot and
    // stay structurally valid. Exercises all 9 undoable mutators under arbitrary
    // sequences, including delete-then-recreate occurrence-id churn.
    for (let seed = 0; seed < RUNS; seed++) {
      const rng = mulberry32(seed * 7919 + 13);
      const ops = generateScript(rng, 10 + (seed % 16), true);
      runUndoRedo(ops, shardedEngine(8), `seed=${seed}`);
    }
  }, 600000);
});

/** Apply a script, then assert undo walks back to each prior snapshot and redo replays
 *  forward to each after snapshot — all while the doc stays structurally valid. Snapshots
 *  are compared via the occ-id-normalized engineView (undo re-creates occurrences with
 *  new opaque ids; structure/content must match regardless). */
function runUndoRedo(ops: Op[], makeEngine: () => Engine, label: string): void {
  const e = makeEngine();
  const occIds: string[] = [];
  const nodeIds: string[] = [];
  const states: string[] = [];
  const capture = (): void => {
    const snap = toJSON(e);
    validateSnapshot(snap);
    states.push(stableStringify(engineView(snap)));
  };
  capture(); // initial state (states[0])
  for (const op of ops) {
    applyOp(e, op, occIds, nodeIds);
    capture();
  }

  for (let i = ops.length - 1; i >= 0; i--) {
    if (!e.canUndo()) {
      throw new Error(`expected canUndo (${label}) before undo #${i}`);
    }
    try {
      e.undo();
    } catch (err) {
      throw new Error(`undo threw (${label}) at i=${i}, op=${ops[i]?.t}: ${String(err)}`, {
        cause: err,
      });
    }
    const got = stableStringify(engineView(toJSON(e)));
    if (got !== states[i]) {
      throw new Error(
        `undo did not revert to before-op state (${label}) at i=${i}\n  got: ${got}\n  exp: ${states[i]}`,
      );
    }
  }
  for (let i = 0; i < ops.length; i++) {
    if (!e.canRedo()) {
      throw new Error(`expected canRedo (${label}) before redo #${i}`);
    }
    try {
      e.redo();
    } catch (err) {
      throw new Error(`redo threw (${label}) at i=${i}, op=${ops[i]?.t}: ${String(err)}`, {
        cause: err,
      });
    }
    const got = stableStringify(engineView(toJSON(e)));
    if (got !== states[i + 1]) {
      throw new Error(
        `redo did not restore after-op state (${label}) at i=${i}\n  got: ${got}\n  exp: ${states[i + 1]}`,
      );
    }
  }
}

import { describe, expect, it } from "vitest";
import { Engine } from "./engine.js";
import { toJSON } from "./serialize.js";
import { cascadeHardDelete, cascadeRemove } from "./cascade.js";
import type { DocSnapshot } from "./types.js";

/**
 * cascade-exhaustive — an INDEPENDENT truth for the remove/hard-delete cascade.
 * Ported from `experiments/multi-shard-tree/test/cascade-exhaustive.test.ts`, now
 * driving the bare core cascade (`core.cascadeRemove` / `cascadeHardDelete`) — the
 * pure occurrence/canonical tree algebra, with no product guards — instead of the
 * prototype's. The cascade currently has no independent spec — only its own tests —
 * so this is the missing witness.
 *
 * For every tiny rooted tree (sizes 2–4) × every transclusion pattern (set
 * partition), enumerate every remove(occurrence) and hardDelete(node), and assert
 * the engine's result equals a BRUTE-FORCE fixpoint closure coded from the prose:
 *   - removing an occurrence removes it and its physical subtree;
 *   - if that occurrence was a node's canonical, the node is killed and ALL its
 *     occurrences (and their subtrees) are removed;
 *   - an occurrence whose node was killed is removed.
 *
 * Engine nodeIds are randomUUIDs, so both the engine projection and the spec are
 * normalized to position-labels (0..maxLabel) before comparing.
 */

/** Index access helper (noUncheckedIndexedAccess + no non-null assertion convention). */
const at = <T>(arr: readonly T[], i: number): T => {
  const v = arr[i];
  if (v === undefined) {
    throw new Error(`index ${i} out of range`);
  }
  return v;
};

type Shape = { k: number; parent: number[]; label: number[] };
type Equiv = {
  dfs: string[];
  occurrenceMetas: string[];
  nodes: Record<
    string,
    { delta: string; props: string; occurrenceCount: number; canonicalDfsIndex: number }
  >;
};

function* forests(k: number): Generator<number[]> {
  const parent: number[] = new Array<number>(k).fill(-1);
  function* rec(i: number): Generator<number[]> {
    if (i === k) {
      yield [...parent];
      return;
    }
    if (i === 0) {
      parent[0] = -1;
      yield* rec(1);
      return;
    }
    for (let p = 0; p < i; p++) {
      parent[i] = p;
      yield* rec(i + 1);
    }
  }
  yield* rec(0);
}

function* rgs(k: number): Generator<number[]> {
  const a: number[] = new Array<number>(k).fill(0);
  function* rec(i: number, maxLabel: number): Generator<number[]> {
    if (i === k) {
      yield [...a];
      return;
    }
    const upper = i === 0 ? 0 : maxLabel + 1;
    for (let v = 0; v <= upper; v++) {
      a[i] = v;
      yield* rec(i + 1, Math.max(maxLabel, v));
    }
  }
  yield* rec(0, 0);
}

function* shapes(sizes: number[]): Generator<Shape> {
  for (const k of sizes) {
    for (const parent of forests(k)) {
      for (const label of rgs(k)) {
        yield { k, parent, label };
      }
    }
  }
}

/** Build the tree in a fresh engine; return position → occurrenceId and label → nodeId. */
async function build(
  shape: Shape,
): Promise<{ e: Engine; occIds: string[]; labelByNodeId: Map<string, string> }> {
  const { k, parent, label } = shape;
  const e = new Engine();
  const occIds: string[] = [];
  const labelByNodeId = new Map<string, string>();
  const firstOf = new Map<number, number>();
  for (let i = 0; i < k; i++) {
    const lab = at(label, i);
    const parentSlot = at(parent, i);
    const parentOcc = parentSlot === -1 ? null : at(occIds, parentSlot);
    let occ;
    if (!firstOf.has(lab)) {
      firstOf.set(lab, i);
      occ = await e.createNode(parentOcc);
      labelByNodeId.set(String(lab), occ.nodeId);
    } else {
      const nid = labelByNodeId.get(String(lab));
      if (nid === undefined) {
        throw new Error("label missing");
      }
      occ = await e.createOccurrence(nid, parentOcc);
    }
    occIds.push(occ.occurrenceId);
  }
  return { e, occIds, labelByNodeId };
}

/** Brute-force surviving positions for an op (independent fixpoint closure). */
function survive(
  shape: Shape,
  op: { kind: "remove"; pos: number } | { kind: "hardDelete"; node: number },
): Set<number> {
  const { k, parent, label } = shape;
  const occsOf = (n: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < k; i++) {
      if (at(label, i) === n) {
        out.push(i);
      }
    }
    return out;
  };
  const canonicalOf = (n: number): number => Math.min(...occsOf(n));
  const removed = new Set<number>(op.kind === "remove" ? [op.pos] : occsOf(op.node));
  let changed = true;
  while (changed) {
    changed = false;
    for (let o = 0; o < k; o++) {
      if (removed.has(o)) {
        continue;
      }
      let anc = at(parent, o);
      while (anc !== -1) {
        if (removed.has(anc)) {
          removed.add(o);
          changed = true;
          break;
        }
        anc = at(parent, anc);
      }
    }
    for (const n of new Set(label)) {
      if (removed.has(canonicalOf(n))) {
        for (const o of occsOf(n)) {
          if (!removed.has(o)) {
            removed.add(o);
            changed = true;
          }
        }
      }
    }
  }
  const live = new Set<number>();
  for (let i = 0; i < k; i++) {
    if (!removed.has(i)) {
      live.add(i);
    }
  }
  return live;
}

/** Expected label-normalized projection from a surviving position set. */
function expected(shape: Shape, live: Set<number>): Equiv {
  const { k, parent, label } = shape;
  const childrenOf = (p: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < k; i++) {
      if (live.has(i) && at(parent, i) === p) {
        out.push(i);
      }
    }
    return out;
  };
  const dfs: string[] = [];
  const occurrenceMetas: string[] = [];
  const dfsIndexOfPos = new Map<number, number>();
  const visit = (pos: number): void => {
    dfsIndexOfPos.set(pos, dfs.length);
    dfs.push(String(at(label, pos)));
    occurrenceMetas.push("{}");
    for (const c of childrenOf(pos)) {
      visit(c);
    }
  };
  for (let i = 0; i < k; i++) {
    if (live.has(i) && at(parent, i) === -1) {
      visit(i);
    }
  }

  const nodes: Equiv["nodes"] = {};
  for (const n of new Set(label)) {
    const occs: number[] = [];
    for (let i = 0; i < k; i++) {
      if (live.has(i) && at(label, i) === n) {
        occs.push(i);
      }
    }
    if (occs.length === 0) {
      continue;
    }
    const canon = Math.min(...occs);
    nodes[String(n)] = {
      delta: "[]",
      props: "{}",
      occurrenceCount: occs.length,
      canonicalDfsIndex: dfsIndexOfPos.get(canon) ?? -1,
    };
  }
  return { dfs, occurrenceMetas, nodes };
}

/** Project the engine's DocSnapshot to a label-normalized projection. */
function equivOf(snap: DocSnapshot, labelByNodeId: Map<string, string>): Equiv {
  const occById = new Map(snap.occurrences.map((o) => [o.occurrenceId, o]));
  const labelOfNode = (nodeId: string): string => {
    for (const [lab, nid] of labelByNodeId) {
      if (nid === nodeId) {
        return lab;
      }
    }
    return "?";
  };
  const dfs: string[] = [];
  const occurrenceMetas: string[] = [];
  const indexByOcc = new Map<string, number>();
  const visit = (occId: string): void => {
    if (indexByOcc.has(occId)) {
      return;
    }
    const occ = occById.get(occId);
    if (!occ) {
      return;
    }
    indexByOcc.set(occId, dfs.length);
    dfs.push(labelOfNode(occ.nodeId));
    occurrenceMetas.push(JSON.stringify(occ.occurrenceMeta ?? {}));
    for (const c of occ.physicalChildOccurrenceIds) {
      visit(c);
    }
  };
  for (const r of snap.rootOccurrenceIds) {
    visit(r);
  }

  const entityByNode = new Map(snap.entities.map((e) => [e.nodeId, e]));
  const occsByNode = new Map<string, string[]>();
  for (const o of snap.occurrences) {
    const list = occsByNode.get(o.nodeId) ?? [];
    list.push(o.occurrenceId);
    occsByNode.set(o.nodeId, list);
  }
  const nodes: Equiv["nodes"] = {};
  for (const [nodeId, occs] of occsByNode) {
    const entity = entityByNode.get(nodeId);
    const canon = entity?.canonicalOccurrenceId ?? "";
    nodes[labelOfNode(nodeId)] = {
      delta: JSON.stringify(entity?.deltas ?? []),
      props: JSON.stringify(entity?.props ?? {}),
      occurrenceCount: occs.length,
      canonicalDfsIndex: indexByOcc.has(canon) ? (indexByOcc.get(canon) ?? -1) : -1,
    };
  }
  return { dfs, occurrenceMetas, nodes };
}

const SIZES = [2, 3, 4];
const same = (a: Equiv, b: Equiv): void => {
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
};

describe("cascade-exhaustive: production cascade == independent brute-force truth", () => {
  it("every enumerated shape builds to the all-live truth (build sanity)", async () => {
    let n = 0;
    for (const s of shapes(SIZES)) {
      const { e, labelByNodeId } = await build(s);
      const allLive = new Set<number>();
      for (let i = 0; i < s.k; i++) {
        allLive.add(i);
      }
      same(equivOf(await toJSON(e), labelByNodeId), expected(s, allLive));
      n++;
    }
    expect(n).toBe(2 + 10 + 90); // B(2)·1! + B(3)·2! + B(4)·3!
  });

  it("every cascadeRemove on every shape matches the brute-force survivor set", async () => {
    let matched = 0;
    let total = 0;
    for (const s of shapes(SIZES)) {
      for (let p = 0; p < s.k; p++) {
        total++;
        const { e, occIds, labelByNodeId } = await build(s);
        await cascadeRemove(e, at(occIds, p));
        same(
          equivOf(await toJSON(e), labelByNodeId),
          expected(s, survive(s, { kind: "remove", pos: p })),
        );
        matched++;
      }
    }
    expect(matched).toBe(total); // every enumerated case matches the spec — no throws
  });

  it("every cascadeHardDelete on every shape matches the brute-force survivor set", async () => {
    let matched = 0;
    let total = 0;
    for (const s of shapes(SIZES)) {
      for (const n of new Set(s.label)) {
        const { e, labelByNodeId } = await build(s);
        const target = labelByNodeId.get(String(n));
        if (target === undefined) {
          continue;
        }
        total++;
        await cascadeHardDelete(e, target);
        same(
          equivOf(await toJSON(e), labelByNodeId),
          expected(s, survive(s, { kind: "hardDelete", node: n })),
        );
        matched++;
      }
    }
    expect(matched).toBe(total); // every enumerated case matches the spec — no throws
  });
});

// History (Step 1 safety net → #4b fix): the ORIGINAL recursive cascade was unsound under
// multi-occurrence transclusion — it revisited an occurrence already deleted earlier in the same
// cascade (mustGetOccurrence threw; heavier topologies even WASM-crashed). This exhaustive test
// caught it (originally `threw > 0`). #4b rewrote the cascade as a bounded worklist with a
// `removed` set (cascadeClosure + applyCascade in core/cascade.ts): pure traversal computes the
// closure, then applies bottom-up through the Engine mutators. The tests above now require every
// enumerated case to match the brute-force spec with no throws.

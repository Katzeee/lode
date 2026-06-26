import { describe, expect, it } from "vitest";
import { ShardedEngine } from "../src/sharded-engine.js";
import { canonicalStructure, stableStringify, type CanonicalStructure } from "../src/compare.js";

/**
 * #4 (cascade half) — an INDEPENDENT truth for the remove/hard-delete cascade.
 *
 * Differential testing (E4) proved the sharded engine ≡ the single-doc oracle,
 * i.e. *transparency*. It did NOT prove *truth*: both engines share the SAME
 * cascade implementation, so a shared bug is invisible to a differential check.
 * This file supplies the missing independent oracle.
 *
 * For every tiny rooted tree (sizes 2–4) and every transclusion pattern (set
 * partition of the positions), we enumerate every remove(occurrence) and
 * hardDelete(node) operation and assert the engine's worklist-cascade result
 * equals a BRUTE-FORCE spec coded from the prose, not from the engine:
 *
 *   - removing an occurrence removes it and its physical subtree;
 *   - if that occurrence was a node's canonical, the node is killed and ALL its
 *     occurrences (and their subtrees) are removed;
 *   - an occurrence whose node was killed is removed.
 *
 * The brute force is a naive repeated-fixpoint closure; the engine uses a single
 * bounded worklist pass. Different algorithms → a shared bug is unlikely to hide.
 *
 * Trees are single-rooted with parent[i] < i (every rooted tree has such a
 * topological labeling), which also fixes root order so the topology-normalized
 * projection is unambiguous.
 */

type Shape = { k: number; parent: number[]; label: number[] };

/** All rooted forests of size k: parent[0] = -1, parent[i] ∈ {0..i-1}. */
function* forests(k: number): Generator<number[]> {
  const parent = new Array(k).fill(-1);
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

/** All transclusion patterns: restricted-growth strings of length k (set partitions). */
function* rgs(k: number): Generator<number[]> {
  const a = new Array(k).fill(0);
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
    for (const parent of forests(k)) for (const label of rgs(k)) yield { k, parent, label };
  }
}

function buildEngine(s: Shape): { e: ShardedEngine; occIds: string[] } {
  const { k, parent, label } = s;
  const e = new ShardedEngine(4);
  const occIds: string[] = [];
  const firstOf = new Map<number, number>();
  for (let i = 0; i < k; i++) {
    const lab = label[i]!;
    const parentOcc = parent[i] === -1 ? null : occIds[parent[i]!]!;
    if (!firstOf.has(lab)) {
      firstOf.set(lab, i);
      occIds.push(e.createNode(String(lab), parentOcc));
    } else {
      occIds.push(e.createReference(String(lab), parentOcc));
    }
  }
  e.commit();
  return { e, occIds };
}

/** Brute-force surviving positions for an op (independent fixpoint closure). */
function survive(
  s: Shape,
  op: { kind: "remove"; pos: number } | { kind: "hardDelete"; node: number },
): Set<number> {
  const { k, parent, label } = s;
  const occsOf = (n: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < k; i++) if (label[i] === n) out.push(i);
    return out;
  };
  const canonicalOf = (n: number): number => Math.min(...occsOf(n));
  const removed = new Set<number>(op.kind === "remove" ? [op.pos] : occsOf(op.node));
  let changed = true;
  while (changed) {
    changed = false;
    for (let o = 0; o < k; o++) {
      if (removed.has(o)) continue;
      let anc = parent[o]!;
      while (anc !== -1) {
        if (removed.has(anc)) {
          removed.add(o);
          changed = true;
          break;
        }
        anc = parent[anc]!;
      }
    }
    for (const n of new Set(label)) {
      if (removed.has(canonicalOf(n))) {
        for (const o of occsOf(n)) if (!removed.has(o)) (removed.add(o), (changed = true));
      }
    }
  }
  const live = new Set<number>();
  for (let i = 0; i < k; i++) if (!removed.has(i)) live.add(i);
  return live;
}

/** Build the expected topology-normalized projection from a surviving position set. */
function expected(s: Shape, live: Set<number>): CanonicalStructure {
  const { k, parent, label } = s;
  const childrenOf = (p: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < k; i++) if (live.has(i) && parent[i] === p) out.push(i);
    return out;
  };
  const dfs: string[] = [];
  const occurrenceMetas: string[] = []; // brute-force trees carry no occurrence meta
  const dfsIndexOfPos = new Map<number, number>();
  const visit = (pos: number): void => {
    dfsIndexOfPos.set(pos, dfs.length);
    dfs.push(String(label[pos]));
    occurrenceMetas.push(stableStringify({}));
    for (const c of childrenOf(pos)) visit(c);
  };
  for (let i = 0; i < k; i++) if (live.has(i) && parent[i] === -1) visit(i);

  const nodes: CanonicalStructure["nodes"] = {};
  for (const n of new Set(label)) {
    const occs: number[] = [];
    for (let i = 0; i < k; i++) if (live.has(i) && label[i] === n) occs.push(i);
    if (occs.length === 0) continue;
    const canon = Math.min(...occs);
    nodes[String(n)] = {
      text: "",
      delta: stableStringify([]), // brute-force trees carry no rich content/marks
      props: stableStringify({}),
      occurrenceCount: occs.length,
      canonicalDfsIndex: dfsIndexOfPos.get(canon) ?? -1,
    };
  }
  return { dfs, occurrenceMetas, nodes };
}

const SIZES = [2, 3, 4];

describe("cascade-exhaustive: engine cascade == independent brute-force truth", () => {
  it("every enumerated shape, built with no op, matches the all-live truth (build sanity)", () => {
    let shapesChecked = 0;
    for (const s of shapes(SIZES)) {
      const { e } = buildEngine(s);
      const allLive = new Set<number>();
      for (let i = 0; i < s.k; i++) allLive.add(i);
      const actual = canonicalStructure(e.snapshot());
      const want = expected(s, allLive);
      expect(stableStringify(actual)).toBe(stableStringify(want));
      shapesChecked++;
    }
    // Confirm the space is non-trivial and fully enumerated.
    expect(shapesChecked).toBe(2 + 10 + 90); // B(2)*1! + B(3)*2! + B(4)*3!
  });

  it("every remove(occurrence) on every shape matches the brute-force survivor set", () => {
    let cases = 0;
    for (const s of shapes(SIZES)) {
      for (let p = 0; p < s.k; p++) {
        const { e, occIds } = buildEngine(s);
        e.removeOccurrence(occIds[p]!);
        e.commit();
        e.validateInvariants();
        const actual = canonicalStructure(e.snapshot());
        const want = expected(s, survive(s, { kind: "remove", pos: p }));
        expect(stableStringify(actual)).toBe(stableStringify(want));
        cases++;
      }
    }
    expect(cases).toBe(4 + 30 + 360); // Σ k · shapes(k): 2·2 + 3·10 + 4·90
  });

  it("every hardDelete(node) on every shape matches the brute-force survivor set", () => {
    let cases = 0;
    for (const s of shapes(SIZES)) {
      for (const n of new Set(s.label)) {
        const { e } = buildEngine(s);
        e.hardDeleteNode(String(n));
        e.commit();
        e.validateInvariants();
        const actual = canonicalStructure(e.snapshot());
        const want = expected(s, survive(s, { kind: "hardDelete", node: n }));
        expect(stableStringify(actual)).toBe(stableStringify(want));
        cases++;
      }
    }
    expect(cases).toBeGreaterThan(0);
  });

  it("self-nesting (a node whose occurrence is a child of another of its occurrences) terminates and matches truth", () => {
    // Node "0" appears at position 0 (root, canonical) and position 1 (child of 0).
    // Removing the canonical must kill the node and the nested occurrence, bounded.
    const s: Shape = { k: 2, parent: [-1, 0], label: [0, 0] };
    const { e, occIds } = buildEngine(s);
    e.removeOccurrence(occIds[0]!); // canonical → hard-delete node 0
    e.commit();
    const actual = canonicalStructure(e.snapshot());
    const want = expected(s, survive(s, { kind: "remove", pos: 0 }));
    expect(stableStringify(actual)).toBe(stableStringify(want));
    expect(actual.dfs).toEqual([]); // whole tree gone
  });
});

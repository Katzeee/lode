import type { NodeId, TreeSnapshot } from "./types.js";

/**
 * Topology-normalized projection of a snapshot, insensitive to opaque
 * occurrence ids. Two engines (single-doc oracle vs multi-shard) driven by the
 * same op log produce DIFFERENT occurrence ids (each LoroDoc mints its own
 * TreeIDs), so raw snapshot equality is meaningless. Instead we compare:
 *
 *   - `dfs`: the nodeId at each DFS preorder position from the roots, in child
 *     order. Captures the outline shape including transclusion multiplicity.
 *   - `occurrenceMetas`: the per-occurrence `meta` at each DFS position — so
 *     managed-child provenance (occurrence-level data) is compared, not hidden.
 *   - `nodes`: per-nodeId content — text AND the rich delta (marks), sorted
 *     props, occurrence count, and the canonical occurrence's DFS index.
 *
 * EXHAUSTIVE over the observable surface: this used to hand-pick fields (plain
 * text only, no meta, no marks), which let two engines pass as "equivalent"
 * while differing on product-observable state. It now compares every field the
 * snapshot type declares. Equality of this projection ⟺ behavioral equivalence.
 */
export type CanonicalStructure = {
  dfs: NodeId[];
  occurrenceMetas: string[]; // stable-stringified meta at each DFS position
  nodes: Record<
    NodeId,
    {
      text: string;
      delta: string; // stable-stringified rich delta (marks preserved)
      props: string; // stable-stringified
      occurrenceCount: number;
      canonicalDfsIndex: number;
    }
  >;
};

export function canonicalStructure(snap: TreeSnapshot): CanonicalStructure {
  const dfs: NodeId[] = [];
  const occurrenceMetas: string[] = [];
  const indexByOcc: Record<string, number> = {};

  const visit = (occId: string): void => {
    if (occId in indexByOcc) return;
    indexByOcc[occId] = dfs.length;
    const occ = snap.occurrences[occId];
    if (!occ) return;
    dfs.push(occ.nodeId);
    occurrenceMetas.push(stableStringify(occ.meta ?? {}));
    for (const c of occ.childOccurrenceIds) visit(c);
  };
  for (const r of snap.roots) visit(r);

  const nodes: CanonicalStructure["nodes"] = {};
  for (const [nodeId, n] of Object.entries(snap.nodes)) {
    nodes[nodeId] = {
      text: n.text,
      delta: stableStringify(n.delta ?? []),
      props: stableStringify(n.props),
      occurrenceCount: n.occurrences.length,
      canonicalDfsIndex:
        n.canonicalOccurrenceId in indexByOcc ? indexByOcc[n.canonicalOccurrenceId]! : -1,
    };
  }
  return { dfs, occurrenceMetas, nodes };
}

/** Deep-equal-ish stable stringification: object keys sorted recursively. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Throws with a diff if the two snapshots are not behaviorally equivalent. */
export function assertEquivalent(a: TreeSnapshot, b: TreeSnapshot, label = ""): void {
  const ca = canonicalStructure(a);
  const cb = canonicalStructure(b);
  const sa = stableStringify(ca);
  const sb = stableStringify(cb);
  if (sa !== sb) {
    throw new Error(
      `Snapshots not equivalent${label ? ` (${label})` : ""}\n  oracle:  ${sa}\n  sharded: ${sb}`,
    );
  }
}

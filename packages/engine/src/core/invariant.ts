import type {
  DocSnapshot,
  NodeId,
  NodeEntitySnapshot,
  NodeOccurrenceSnapshot,
  OccurrenceId,
} from "./types.js";

/**
 * Structural invariants over a serializable `DocSnapshot` — the engine's
 * correctness contract. Ported from the sharded-engine prototype
 * (`experiments/multi-shard-tree/src/invariant.ts`) and adapted to production's
 * `DocSnapshot` (entities + occurrences with `physicalChildOccurrenceIds` +
        occurrence-meta + roots), which the `toJSON(engine)` serializer produces.
 *
 * Checks no-cycle / no-detached-subtree / full parent↔child / canonical-membership /
 * orphan-entity. Throws on the first violation with a precise message. Pure function —
 * safe at runtime (e.g. after import/restart) and in tests.
 *
 * `validateOccurrenceStructure` is the tree-only half (zero entity reads): it checks the
 * occurrence graph reachable from roots is acyclic, fully parent↔child linked, and every
 * occurrence is reachable. `validateSnapshot` adds the entity-dependent checks (every
 * occurrence's entity exists; canonical membership) on top.
 */

/** Index `occurrences` by id + by node, checking occurrence-level uniqueness along the way. Shared
 *  by the tree-only + full validators so the indexing isn't done twice. */
function indexOccurrences(occurrences: readonly NodeOccurrenceSnapshot[]): {
  occById: Map<OccurrenceId, NodeOccurrenceSnapshot>;
  occsByNode: Map<NodeId, OccurrenceId[]>;
} {
  const occById = new Map<OccurrenceId, NodeOccurrenceSnapshot>();
  const occsByNode = new Map<NodeId, OccurrenceId[]>();
  const occIdsSeen = new Set<string>();
  for (const occ of occurrences) {
    if (occById.has(occ.occurrenceId)) {
      throw new Error(`Duplicate occurrence: ${occ.occurrenceId}`);
    }
    occById.set(occ.occurrenceId, occ);
    // occId is the undo reconciliation key — must be present and unique.
    if (typeof occ.occId !== "string" || occ.occId.length === 0) {
      throw new Error(`Occurrence ${occ.occurrenceId} missing occId`);
    }
    if (occIdsSeen.has(occ.occId)) {
      throw new Error(`Duplicate occId: ${occ.occId}`);
    }
    occIdsSeen.add(occ.occId);
    const list = occsByNode.get(occ.nodeId) ?? [];
    list.push(occ.occurrenceId);
    occsByNode.set(occ.nodeId, list);
  }
  return { occById, occsByNode };
}

/** The tree-only structural checks over an occurrence graph: roots exist + have no parent; every
 *  occurrence's parent exists; full parent↔child linkage; no cycles / no detached subtrees (every
 *  occurrence reachable from a root exactly once). NO entity reads — usable on the tree-only
 *  `toJSONOccurrences` snapshot (e.g. the fork's post-reconcile safety check, which avoids a second
 *  full-shard walk). */
export function validateOccurrenceStructure(
  occurrences: readonly NodeOccurrenceSnapshot[],
  rootOccurrenceIds: readonly OccurrenceId[],
): void {
  const { occById } = indexOccurrences(occurrences);

  // 1. Roots exist and have no parent.
  for (const rootId of rootOccurrenceIds) {
    const occ = occById.get(rootId);
    if (!occ) {
      throw new Error(`Root ${rootId} not in occurrences`);
    }
    if (occ.parentOccurrenceId !== null) {
      throw new Error(`Root ${rootId} has parent ${occ.parentOccurrenceId}`);
    }
  }

  // 2. Every occurrence's parent exists.
  for (const occ of occurrences) {
    if (occ.parentOccurrenceId !== null && !occById.has(occ.parentOccurrenceId)) {
      throw new Error(
        `Occurrence ${occ.occurrenceId} has missing parent ${occ.parentOccurrenceId}`,
      );
    }
  }

  // 3. Parent ↔ child consistency.
  for (const occ of occurrences) {
    for (const childId of occ.physicalChildOccurrenceIds) {
      const child = occById.get(childId);
      if (!child) {
        throw new Error(`Occurrence ${occ.occurrenceId} has missing child ${childId}`);
      }
      if (child.parentOccurrenceId !== occ.occurrenceId) {
        throw new Error(
          `Child ${childId} parent is ${child.parentOccurrenceId}, expected ${occ.occurrenceId}`,
        );
      }
    }
  }

  // 4. No cycles and no detached subtrees: DFS from roots visits every occurrence
  //    exactly once. An occurrence unreachable from any root is structurally invalid.
  const visited = new Set<OccurrenceId>();
  const stack: OccurrenceId[] = [...rootOccurrenceIds];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (visited.has(cur)) {
      throw new Error(`Cycle or shared subtree reached twice at ${cur}`);
    }
    visited.add(cur);
    const occ = occById.get(cur);
    if (occ) {
      for (const childId of occ.physicalChildOccurrenceIds) {
        stack.push(childId);
      }
    }
  }
  for (const occ of occurrences) {
    if (!visited.has(occ.occurrenceId)) {
      throw new Error(`Detached occurrence ${occ.occurrenceId} (unreachable from roots)`);
    }
  }
}

export function validateSnapshot(snap: DocSnapshot): void {
  const entityById = new Map<NodeId, NodeEntitySnapshot>();
  for (const entity of snap.entities) {
    if (entityById.has(entity.nodeId)) {
      throw new Error(`Duplicate entity: ${entity.nodeId}`);
    }
    entityById.set(entity.nodeId, entity);
  }

  const { occById, occsByNode } = indexOccurrences(snap.occurrences);
  validateOccurrenceStructure(snap.occurrences, snap.rootOccurrenceIds);

  // 5. Every occurrence references an entity that exists.
  for (const occ of snap.occurrences) {
    if (!entityById.has(occ.nodeId)) {
      throw new Error(`Occurrence ${occ.occurrenceId} references missing node ${occ.nodeId}`);
    }
  }

  // 6. Canonical validity: canonical ∈ the node's occurrences and points back.
  //    (This also subsumes the orphan-entity check: an entity with no occurrences
  //    has a canonical that is not in its empty occurrence list.)
  for (const entity of snap.entities) {
    const occs = occsByNode.get(entity.nodeId) ?? [];
    if (!occs.includes(entity.canonicalOccurrenceId)) {
      throw new Error(
        `Node ${entity.nodeId} canonical ${entity.canonicalOccurrenceId} not in its occurrences`,
      );
    }
    const canon = occById.get(entity.canonicalOccurrenceId);
    if (!canon || canon.nodeId !== entity.nodeId) {
      throw new Error(`Node ${entity.nodeId} canonical occurrence does not point back`);
    }
  }
}

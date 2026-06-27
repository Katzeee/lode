import type { DocSnapshot, NodeId, OccurrenceId } from "./types.js";

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
 */
export function validateSnapshot(snap: DocSnapshot): void {
  const entityById = new Map<NodeId, (typeof snap.entities)[number]>();
  for (const entity of snap.entities) {
    if (entityById.has(entity.nodeId)) {
      throw new Error(`Duplicate entity: ${entity.nodeId}`);
    }
    entityById.set(entity.nodeId, entity);
  }

  const occById = new Map<OccurrenceId, (typeof snap.occurrences)[number]>();
  const occsByNode = new Map<NodeId, OccurrenceId[]>();
  const occIdsSeen = new Set<string>();
  for (const occ of snap.occurrences) {
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

  // 1. Roots exist and have no parent.
  for (const rootId of snap.rootOccurrenceIds) {
    const occ = occById.get(rootId);
    if (!occ) {
      throw new Error(`Root ${rootId} not in occurrences`);
    }
    if (occ.parentOccurrenceId !== null) {
      throw new Error(`Root ${rootId} has parent ${occ.parentOccurrenceId}`);
    }
  }

  // 2. Every occurrence is well-formed; its entity exists; its parent exists.
  for (const occ of snap.occurrences) {
    if (!entityById.has(occ.nodeId)) {
      throw new Error(`Occurrence ${occ.occurrenceId} references missing node ${occ.nodeId}`);
    }
    if (occ.parentOccurrenceId !== null && !occById.has(occ.parentOccurrenceId)) {
      throw new Error(
        `Occurrence ${occ.occurrenceId} has missing parent ${occ.parentOccurrenceId}`,
      );
    }
  }

  // 3. Parent ↔ child consistency.
  for (const occ of snap.occurrences) {
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
  const stack: OccurrenceId[] = [...snap.rootOccurrenceIds];
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
  for (const occ of snap.occurrences) {
    if (!visited.has(occ.occurrenceId)) {
      throw new Error(`Detached occurrence ${occ.occurrenceId} (unreachable from roots)`);
    }
  }

  // 5. Canonical validity: canonical ∈ the node's occurrences and points back.
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

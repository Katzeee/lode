import type { Engine } from "./engine.js";

/** Remove an occurrence, cascading through its physical subtree and — if it is its node's
 *  canonical occurrence — every occurrence of that node (hard-deleting it). The bare forest
 *  cascade: no product guards. Domain wraps this (`removeOccurrenceOrHardDelete`) with the
 *  managed-child guard for user paths; authorized system callers (field lifecycle, schema
 *  reconcile) and engine tests use this bare entry directly. */
export async function cascadeRemove(engine: Engine, occurrenceId: string): Promise<void> {
  await engine.batch(async () => {
    const { removed, deletedNodes } = await cascadeClosure(engine, [occurrenceId]);
    await applyCascade(engine, removed, deletedNodes);
  });
}

/** Hard-delete a node: cascade every occurrence of the node (and their subtrees). The bare forest
 *  cascade: no product guards. The product path (`hardDeleteNode`) computes the same closure, runs
 *  the protected-node guard over it, then applies it — so guard and delete share one traversal.
 *  This bare entry stays for engine tests. */
export async function cascadeHardDelete(engine: Engine, nodeId: string): Promise<void> {
  await engine.batch(async () => {
    const seeds = (await engine.getOccurrences(nodeId)).map(
      (occurrence) => occurrence.occurrenceId,
    );
    const { removed, deletedNodes } = await cascadeClosure(engine, seeds);
    await applyCascade(engine, removed, deletedNodes);
  });
}

/**
 * Compute the removal closure by worklist, WITHOUT mutating — so a node referenced
 * from several places (transclusion) is enqueued many times but processed once (the
 * `removed` set bounds the work; the old recursive form revisited deleted occurrences
 * and crashed). Closure rules: an occurrence drags its physical subtree; an occurrence
 * that IS its node's canonical drags every occurrence of that node (and their subtrees).
 * A node is deleted iff its canonical ends up removed.
 */
export async function cascadeClosure(
  engine: Engine,
  seeds: string[],
): Promise<{ removed: Set<string>; deletedNodes: Set<string> }> {
  const removed = new Set<string>();
  const work = [...seeds];
  while (work.length > 0) {
    const occId = work.pop()!;
    if (removed.has(occId)) {
      continue;
    }
    const occ = await engine.getOccurrence(occId);
    if (!occ) {
      continue;
    }
    removed.add(occId);
    for (const child of await engine.getOccurrenceChildren(occId)) {
      work.push(child.occurrenceId);
    }
    if (occId === occ.canonicalOccurrenceId) {
      for (const sibling of await engine.getOccurrences(occ.nodeId)) {
        work.push(sibling.occurrenceId);
      }
    }
  }
  const deletedNodes = new Set<string>();
  for (const occId of removed) {
    const occ = await engine.getOccurrence(occId);
    if (occ && occId === occ.canonicalOccurrenceId) {
      deletedNodes.add(occ.nodeId);
    }
  }
  return { removed, deletedNodes };
}

/**
 * Apply the closure through the Engine mutators (events + history), bottom-up to a
 * fixpoint: drop leaf occurrences of surviving nodes via removeOccurrence, and kill
 * nodes via deleteNode once all their occurrences are leaves. The fixpoint resolves
 * inter-node dependencies (a killed node nested under another) without explicit depth
 * ordering. removeOccurrence/deleteNode's leaf + non-canonical guards hold by
 * construction (surviving occurrences are non-canonical; killed nodes' occurrences are
 * all in the closure, so their children clear first).
 */
export async function applyCascade(
  engine: Engine,
  removed: Set<string>,
  deletedNodes: Set<string>,
): Promise<void> {
  const appliedOcc = new Set<string>();
  const appliedNode = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const occId of removed) {
      if (appliedOcc.has(occId)) {
        continue;
      }
      const occ = await engine.getOccurrence(occId);
      if (!occ) {
        appliedOcc.add(occId);
        progress = true;
        continue;
      }
      // The canonical occurrence of a killed node is dropped via deleteNode
      // (removeOccurrence throws on canonical). Non-canonical occurrences of a killed
      // node — including a self-nested one under the canonical — are removed here, so
      // the canonical can become a leaf before deleteNode runs.
      if (deletedNodes.has(occ.nodeId) && occId === occ.canonicalOccurrenceId) {
        continue;
      }
      if (engine.getChildOccurrenceIds(occId).length === 0) {
        await engine.removeOccurrence(occId);
        appliedOcc.add(occId);
        progress = true;
      }
    }
    for (const nodeId of deletedNodes) {
      if (appliedNode.has(nodeId)) {
        continue;
      }
      const occs = await engine.getOccurrences(nodeId);
      if (
        occs.length === 0 ||
        occs.every((occ) => engine.getChildOccurrenceIds(occ.occurrenceId).length === 0)
      ) {
        await engine.deleteNode(nodeId);
        appliedNode.add(nodeId);
        for (const occ of occs) {
          appliedOcc.add(occ.occurrenceId);
        }
        progress = true;
      }
    }
  }
}

import type { Engine, NodeOccurrence } from "../core/index.js";

export async function createPlainNode(
  doc: Engine,
  parentOccurrenceId?: string | null,
  index?: number,
  props?: Record<string, unknown>,
): Promise<NodeOccurrence> {
  return doc.createNode(await canonicalChildOwnerOf(doc, parentOccurrenceId), index, props);
}

export async function createReference(
  doc: Engine,
  targetNodeId: string,
  parentOccurrenceId?: string | null,
  index?: number,
): Promise<NodeOccurrence> {
  return doc.createOccurrence(
    targetNodeId,
    await canonicalChildOwnerOf(doc, parentOccurrenceId),
    index,
  );
}

export async function moveOccurrence(
  doc: Engine,
  occurrenceId: string,
  parentOccurrenceId: string | null,
  index?: number,
): Promise<void> {
  await doc.moveOccurrence(
    occurrenceId,
    await canonicalChildOwnerOf(doc, parentOccurrenceId),
    index,
  );
}

export async function cloneOccurrence(
  doc: Engine,
  occurrenceId: string,
  parentOccurrenceId?: string | null,
  index?: number,
): Promise<NodeOccurrence> {
  // One undo step for the whole subtree clone. The recursion uses the inner fn so it does
  // not open its own group (transact is re-entrant anyway, but this avoids redundant snapshots).
  return doc.batch(async () =>
    cloneOccurrenceInner(doc, occurrenceId, parentOccurrenceId ?? null, index),
  );
}

async function cloneOccurrenceInner(
  doc: Engine,
  occurrenceId: string,
  parentOccurrenceId: string | null,
  index?: number,
): Promise<NodeOccurrence> {
  const clone = await createPlainNode(
    doc,
    parentOccurrenceId,
    index,
    await doc.getProps(occurrenceId),
  );
  await doc.replaceDeltas(clone.occurrenceId, await doc.getDeltas(occurrenceId));
  for (const child of await getSemanticChildren(doc, occurrenceId)) {
    await cloneOccurrenceInner(doc, child.occurrenceId, clone.occurrenceId);
  }
  return doc.mustGetOccurrence(clone.occurrenceId);
}

export async function promoteCanonicalOccurrence(
  doc: Engine,
  nodeId: string,
  occurrenceId: string,
): Promise<void> {
  const oldCanonicalId = await doc.getCanonicalOccurrenceId(nodeId);
  if (oldCanonicalId === occurrenceId) {
    return;
  }
  const childIds = doc.getChildOccurrenceIds(oldCanonicalId);
  await doc.batch(async () => {
    for (const [index, childId] of childIds.entries()) {
      await doc.moveOccurrence(childId, occurrenceId, index);
    }
    await doc.setCanonicalOccurrence(nodeId, occurrenceId);
  });
}

export async function removeOccurrenceOrHardDelete(
  doc: Engine,
  occurrenceId: string,
): Promise<void> {
  // One undo step for the whole cascade (joins an outer batch if called inside one, e.g.
  // setFieldValues).
  await doc.batch(async () => {
    const { removed, deletedNodes } = await cascadeClosure(doc, [occurrenceId]);
    await applyCascade(doc, removed, deletedNodes);
  });
}

export async function hardDeleteNode(doc: Engine, nodeId: string): Promise<void> {
  await doc.batch(async () => {
    const seeds = (await doc.getOccurrences(nodeId)).map((occurrence) => occurrence.occurrenceId);
    const { removed, deletedNodes } = await cascadeClosure(doc, seeds);
    await applyCascade(doc, removed, deletedNodes);
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
async function cascadeClosure(
  doc: Engine,
  seeds: string[],
): Promise<{ removed: Set<string>; deletedNodes: Set<string> }> {
  const removed = new Set<string>();
  const work = [...seeds];
  while (work.length > 0) {
    const occId = work.pop()!;
    if (removed.has(occId)) {
      continue;
    }
    const occ = await doc.getOccurrence(occId);
    if (!occ) {
      continue;
    }
    removed.add(occId);
    for (const child of await doc.getOccurrenceChildren(occId)) {
      work.push(child.occurrenceId);
    }
    if (occId === occ.canonicalOccurrenceId) {
      for (const sibling of await doc.getOccurrences(occ.nodeId)) {
        work.push(sibling.occurrenceId);
      }
    }
  }
  const deletedNodes = new Set<string>();
  for (const occId of removed) {
    const occ = await doc.getOccurrence(occId);
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
async function applyCascade(
  doc: Engine,
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
      const occ = await doc.getOccurrence(occId);
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
      if (doc.getChildOccurrenceIds(occId).length === 0) {
        await doc.removeOccurrence(occId);
        appliedOcc.add(occId);
        progress = true;
      }
    }
    for (const nodeId of deletedNodes) {
      if (appliedNode.has(nodeId)) {
        continue;
      }
      const occs = await doc.getOccurrences(nodeId);
      if (
        occs.length === 0 ||
        occs.every((occ) => doc.getChildOccurrenceIds(occ.occurrenceId).length === 0)
      ) {
        await doc.deleteNode(nodeId);
        appliedNode.add(nodeId);
        for (const occ of occs) {
          appliedOcc.add(occ.occurrenceId);
        }
        progress = true;
      }
    }
  }
}

export async function getSemanticChildren(
  doc: Engine,
  occurrenceId: string,
): Promise<NodeOccurrence[]> {
  const ownerId = await canonicalChildOwnerOf(doc, occurrenceId);
  return ownerId == null ? [] : doc.getOccurrenceChildren(ownerId);
}

async function canonicalChildOwnerOf(
  doc: Engine,
  occurrenceId?: string | null,
): Promise<string | null> {
  if (occurrenceId == null) {
    return null;
  }
  return doc.getCanonicalOccurrenceId((await doc.mustGetOccurrence(occurrenceId)).nodeId);
}

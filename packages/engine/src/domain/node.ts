import type { Engine, NodeOccurrence } from "../core/index.js";

export function createPlainNode(
  doc: Engine,
  parentOccurrenceId?: string | null,
  index?: number,
  props?: Record<string, unknown>,
): NodeOccurrence {
  return doc.createNode(canonicalChildOwnerOf(doc, parentOccurrenceId), index, props);
}

export function createReference(
  doc: Engine,
  targetNodeId: string,
  parentOccurrenceId?: string | null,
  index?: number,
): NodeOccurrence {
  return doc.createOccurrence(targetNodeId, canonicalChildOwnerOf(doc, parentOccurrenceId), index);
}

export function moveOccurrence(
  doc: Engine,
  occurrenceId: string,
  parentOccurrenceId: string | null,
  index?: number,
): void {
  doc.moveOccurrence(occurrenceId, canonicalChildOwnerOf(doc, parentOccurrenceId), index);
}

export function cloneOccurrence(
  doc: Engine,
  occurrenceId: string,
  parentOccurrenceId?: string | null,
  index?: number,
): NodeOccurrence {
  // One undo step for the whole subtree clone. The recursion uses the inner fn so it does
  // not open its own group (transact is re-entrant anyway, but this avoids redundant snapshots).
  return doc.batch(() =>
    cloneOccurrenceInner(doc, occurrenceId, parentOccurrenceId ?? null, index),
  );
}

function cloneOccurrenceInner(
  doc: Engine,
  occurrenceId: string,
  parentOccurrenceId: string | null,
  index?: number,
): NodeOccurrence {
  const clone = createPlainNode(doc, parentOccurrenceId, index, doc.getProps(occurrenceId));
  doc.replaceDeltas(clone.occurrenceId, doc.getDeltas(occurrenceId));
  for (const child of getSemanticChildren(doc, occurrenceId)) {
    cloneOccurrenceInner(doc, child.occurrenceId, clone.occurrenceId);
  }
  return doc.mustGetOccurrence(clone.occurrenceId);
}

export function promoteCanonicalOccurrence(
  doc: Engine,
  nodeId: string,
  occurrenceId: string,
): void {
  const oldCanonicalId = doc.getCanonicalOccurrenceId(nodeId);
  if (oldCanonicalId === occurrenceId) {
    return;
  }
  const childIds = doc.getChildOccurrenceIds(oldCanonicalId);
  doc.batch(() => {
    for (const [index, childId] of childIds.entries()) {
      doc.moveOccurrence(childId, occurrenceId, index);
    }
    doc.setCanonicalOccurrence(nodeId, occurrenceId);
  });
}

export function removeOccurrenceOrHardDelete(doc: Engine, occurrenceId: string): void {
  // One undo step for the whole cascade (joins an outer batch if called inside one, e.g.
  // setFieldValues).
  doc.batch(() => {
    const { removed, deletedNodes } = cascadeClosure(doc, [occurrenceId]);
    applyCascade(doc, removed, deletedNodes);
  });
}

export function hardDeleteNode(doc: Engine, nodeId: string): void {
  doc.batch(() => {
    const seeds = doc.getOccurrences(nodeId).map((occurrence) => occurrence.occurrenceId);
    const { removed, deletedNodes } = cascadeClosure(doc, seeds);
    applyCascade(doc, removed, deletedNodes);
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
function cascadeClosure(
  doc: Engine,
  seeds: string[],
): { removed: Set<string>; deletedNodes: Set<string> } {
  const removed = new Set<string>();
  const work = [...seeds];
  while (work.length > 0) {
    const occId = work.pop()!;
    if (removed.has(occId)) {
      continue;
    }
    const occ = doc.getOccurrence(occId);
    if (!occ) {
      continue;
    }
    removed.add(occId);
    for (const child of doc.getOccurrenceChildren(occId)) {
      work.push(child.occurrenceId);
    }
    if (occId === occ.canonicalOccurrenceId) {
      for (const sibling of doc.getOccurrences(occ.nodeId)) {
        work.push(sibling.occurrenceId);
      }
    }
  }
  const deletedNodes = new Set<string>();
  for (const occId of removed) {
    const occ = doc.getOccurrence(occId);
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
function applyCascade(doc: Engine, removed: Set<string>, deletedNodes: Set<string>): void {
  const appliedOcc = new Set<string>();
  const appliedNode = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const occId of removed) {
      if (appliedOcc.has(occId)) {
        continue;
      }
      const occ = doc.getOccurrence(occId);
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
        doc.removeOccurrence(occId);
        appliedOcc.add(occId);
        progress = true;
      }
    }
    for (const nodeId of deletedNodes) {
      if (appliedNode.has(nodeId)) {
        continue;
      }
      const occs = doc.getOccurrences(nodeId);
      if (
        occs.length === 0 ||
        occs.every((occ) => doc.getChildOccurrenceIds(occ.occurrenceId).length === 0)
      ) {
        doc.deleteNode(nodeId);
        appliedNode.add(nodeId);
        for (const occ of occs) {
          appliedOcc.add(occ.occurrenceId);
        }
        progress = true;
      }
    }
  }
}

export function getSemanticChildren(doc: Engine, occurrenceId: string): NodeOccurrence[] {
  const ownerId = canonicalChildOwnerOf(doc, occurrenceId);
  return ownerId == null ? [] : doc.getOccurrenceChildren(ownerId);
}

function canonicalChildOwnerOf(doc: Engine, occurrenceId?: string | null): string | null {
  if (occurrenceId == null) {
    return null;
  }
  return doc.getCanonicalOccurrenceId(doc.mustGetOccurrence(occurrenceId).nodeId);
}

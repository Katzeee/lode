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
  const clone = createPlainNode(doc, parentOccurrenceId ?? null, index, doc.getProps(occurrenceId));
  doc.replaceDeltas(clone.occurrenceId, doc.getDeltas(occurrenceId));
  for (const child of getSemanticChildren(doc, occurrenceId)) {
    cloneOccurrence(doc, child.occurrenceId, clone.occurrenceId);
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
  const node = doc.mustGetOccurrence(occurrenceId);
  if (occurrenceId === node.canonicalOccurrenceId) {
    hardDeleteNode(doc, node.nodeId);
    return;
  }
  for (const child of doc.getOccurrenceChildren(occurrenceId)) {
    removeOccurrenceOrHardDelete(doc, child.occurrenceId);
  }
  doc.removeOccurrence(occurrenceId);
}

export function hardDeleteNode(doc: Engine, nodeId: string): void {
  for (const occurrence of doc.getOccurrences(nodeId)) {
    for (const child of doc.getOccurrenceChildren(occurrence.occurrenceId)) {
      removeOccurrenceOrHardDelete(doc, child.occurrenceId);
    }
  }
  doc.deleteNode(nodeId);
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

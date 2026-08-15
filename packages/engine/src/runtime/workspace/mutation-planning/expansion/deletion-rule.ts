import { stableStringCompare, type Mutation } from "../../../../domain/fact/index.js";
import { singleMutationWrite, type MutationWrite } from "../../../../domain/edit/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";
import { atomicExpansion } from "./mutation-write.js";

export function expandNodeDeletion(
  mutation: Extract<Mutation, { kind: "node-delete" }>,
  available: ScopedProjection,
): MutationWrite {
  return atomicExpansion(deleteOwnedSubtree(mutation.nodeId, available));
}

export function expandOccurrenceDeletion(
  mutation: Extract<Mutation, { kind: "occurrence-delete" }>,
  available: ScopedProjection,
): MutationWrite {
  const occurrence = available.occurrences[mutation.occurrenceId];
  return occurrence && available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId
    ? atomicExpansion(deleteOwnedSubtree(occurrence.nodeId, available))
    : singleMutationWrite(mutation);
}

export function deletePlacement(occurrenceId: string, available: ScopedProjection): readonly Mutation[] {
  const occurrence = available.occurrences[occurrenceId];
  if (!occurrence) {
    return [];
  }
  return available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId
    ? [{ kind: "occurrence-delete", occurrenceId }, ...deleteOwnedSubtree(occurrence.nodeId, available)]
    : [{ kind: "occurrence-delete", occurrenceId }];
}

function deleteOwnedSubtree(nodeId: string, available: ScopedProjection): readonly Mutation[] {
  const nodeIds = [nodeId];
  const visited = new Set(nodeIds);
  for (let index = 0; index < nodeIds.length; index += 1) {
    const parentNodeId = nodeIds[index];
    const children = Object.entries(available.nodeOwners)
      .filter(([ownedNodeId, ownerNodeId]) => ownerNodeId === parentNodeId && !visited.has(ownedNodeId))
      .map(([ownedNodeId]) => ownedNodeId)
      .sort(stableStringCompare);
    children.forEach((ownedNodeId) => visited.add(ownedNodeId));
    nodeIds.push(...children);
  }
  return nodeIds.reverse().map((ownedNodeId) => ({ kind: "node-delete", nodeId: ownedNodeId }));
}

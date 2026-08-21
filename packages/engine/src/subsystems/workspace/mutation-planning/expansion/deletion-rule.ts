import type { Mutation } from "../../../../domain/fact/index.js";
import {
  atomicMutationWrite,
  mutationWriteMembers,
  singleMutationWrite,
  type MutationWrite,
} from "../../../../domain/edit/index.js";
import { nodeLocation, occurrenceAnchor, type ScopedProjection } from "../../../../domain/reconcile/index.js";

export function expandNodeDeletion(
  mutation: Extract<Mutation, { kind: "node-delete" }>,
  available: ScopedProjection,
): MutationWrite {
  const trashNodeId = available.workspaceSystemNodes.trash;
  const ownerNodeId = available.nodeOwners[mutation.nodeId];
  const candidates = Object.values(available.occurrences).filter((candidate) => candidate.nodeId === mutation.nodeId);
  const occurrence = candidates.find((candidate) => candidate.parentNodeId === ownerNodeId) ?? candidates[0];
  if (
    trashNodeId === undefined ||
    nodeLocation(available.identity.workspaceNodeId, available, mutation.nodeId) !== "active" ||
    ownerNodeId === undefined ||
    ownerNodeId === null ||
    occurrence === undefined
  ) {
    throw new Error("Delete target has no active owning Occurrence");
  }
  return atomicMutationWrite([
    mutation,
    {
      kind: "node-owner-set",
      nodeId: mutation.nodeId,
      ownerNodeId: trashNodeId,
      previousOwnerNodeId: ownerNodeId,
    },
    {
      kind: "occurrence-move",
      occurrenceId: occurrence.occurrenceId,
      parentNodeId: trashNodeId,
      anchor: { after: null, before: null, affinity: "after", fallback: "end" },
      previousParentNodeId: occurrence.parentNodeId,
      previousAnchor: occurrenceAnchor(available, occurrence.occurrenceId),
    },
  ]);
}

export function expandOccurrenceDeletion(
  mutation: Extract<Mutation, { kind: "occurrence-delete" }>,
  available: ScopedProjection,
): MutationWrite {
  const occurrence = available.occurrences[mutation.occurrenceId];
  return occurrence && available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId
    ? expandNodeDeletion({ kind: "node-delete", nodeId: occurrence.nodeId }, available)
    : singleMutationWrite(mutation);
}

export function deletePlacement(occurrenceId: string, available: ScopedProjection): readonly Mutation[] {
  const occurrence = available.occurrences[occurrenceId];
  if (!occurrence) {
    return [];
  }
  return available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId
    ? mutationWriteMembers(expandNodeDeletion({ kind: "node-delete", nodeId: occurrence.nodeId }, available))
    : [{ kind: "occurrence-delete", occurrenceId }];
}

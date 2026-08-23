import type { AuthoredAction } from "../../../../domain/fact/index.js";
import { singleAuthoredActionBatch, type AuthoredActionBatch } from "../action-batch.js";
import { nodeLocation, type ScopedProjection } from "../../../../domain/reconcile/index.js";

function expandNodeDeletion(
  action: Readonly<{ kind: "node-delete"; nodeId: string }>,
  available: ScopedProjection,
): AuthoredActionBatch {
  const trashNodeId = available.workspaceSystemNodes.trash;
  const ownerNodeId = available.nodeOwners[action.nodeId];
  const candidates = Object.values(available.occurrences).filter((candidate) => candidate.nodeId === action.nodeId);
  const occurrence = candidates.find((candidate) => candidate.parentNodeId === ownerNodeId) ?? candidates[0];
  if (
    trashNodeId === undefined ||
    nodeLocation(available.identity.workspaceNodeId, available, action.nodeId) !== "active" ||
    ownerNodeId === undefined ||
    ownerNodeId === null ||
    occurrence === undefined
  ) {
    throw new Error("Delete target has no active owning Occurrence");
  }
  return singleAuthoredActionBatch({ kind: "node-trash", nodeId: action.nodeId });
}

export function expandPlacementRemoval(
  action: Extract<AuthoredAction, { kind: "placement-remove" }>,
  available: ScopedProjection,
): AuthoredActionBatch {
  const occurrence = available.occurrences[action.placementId];
  return occurrence && available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId
    ? expandNodeDeletion({ kind: "node-delete", nodeId: occurrence.nodeId }, available)
    : singleAuthoredActionBatch(action);
}

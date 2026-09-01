import type { GraphAction } from "../../../domain/fact/index.js";
import { singleAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";
import { nodeLocation, type InterpretedProjection } from "../../../domain/reconcile/index.js";
import { EditPlanningRejection } from "./planning-rejection.js";

function expandNodeDeletion(
  action: Readonly<{ kind: "node-delete"; nodeId: string }>,
  available: InterpretedProjection,
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
    throw new EditPlanningRejection("Delete target has no active owning Occurrence");
  }
  return singleAuthoredActionBatch({ kind: "node-trash", nodeId: action.nodeId });
}

export function expandPlacementRemoval(
  action: Extract<GraphAction, { kind: "placement-remove" }>,
  available: InterpretedProjection,
): AuthoredActionBatch {
  const occurrence = available.occurrences[action.placementId];
  return occurrence && available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId
    ? expandNodeDeletion({ kind: "node-delete", nodeId: occurrence.nodeId }, available)
    : singleAuthoredActionBatch(action);
}

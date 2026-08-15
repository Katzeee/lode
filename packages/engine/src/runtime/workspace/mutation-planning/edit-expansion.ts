import {
  expandEditMutation,
  singleMutationWrite,
  type EditMutation,
  type MutationWrite,
} from "../../../domain/edit/index.js";
import type { Mutation } from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";

export function expandPlanningEdit(edit: EditMutation, available: ScopedProjection): MutationWrite {
  return edit.kind === "reference-promote"
    ? singleMutationWrite(prepareReferencePromotion(edit.occurrenceId, available))
    : expandEditMutation(edit);
}

export function assertNoWorkspaceCreation(workspaceId: string, operations: readonly EditMutation[]): void {
  if (operations.some((operation) => operation.kind === "node-create" && operation.nodeId === workspaceId)) {
    throw new Error("Workspace identity is created only by Workspace genesis");
  }
}

function prepareReferencePromotion(occurrenceId: string, available: ScopedProjection): Mutation {
  const occurrence = available.occurrences[occurrenceId];
  if (!occurrence) {
    throw new Error("Reference promotion target is absent from the current Projection");
  }
  if (available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId) {
    throw new Error("Reference promotion target is already the Original Occurrence");
  }
  return {
    kind: "node-owner-set",
    nodeId: occurrence.nodeId,
    ownerNodeId: occurrence.parentNodeId,
  };
}

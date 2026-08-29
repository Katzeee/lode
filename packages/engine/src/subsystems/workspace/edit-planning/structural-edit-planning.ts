import { expandEditAction, type EditAction } from "../../../domain/edit/index.js";
import type { GraphAction } from "../../../domain/fact/index.js";
import { nodeLocation, type InterpretedProjection } from "../../../domain/reconcile/index.js";
import { singleAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";

const STRUCTURAL_EDIT_KINDS = [
  "node-create",
  "node-delete",
  "node-restore",
  "reference-promote",
  "occurrence-create",
  "occurrence-delete",
  "occurrence-restore",
  "occurrence-move",
] as const satisfies readonly EditAction["kind"][];

type StructuralEdit = Extract<EditAction, { kind: (typeof STRUCTURAL_EDIT_KINDS)[number] }>;

export function isStructuralEdit(edit: EditAction): edit is StructuralEdit {
  return (STRUCTURAL_EDIT_KINDS as readonly EditAction["kind"][]).includes(edit.kind);
}

export function prepareStructuralEdit(edit: StructuralEdit, available: InterpretedProjection): AuthoredActionBatch {
  switch (edit.kind) {
    case "node-create":
      if (nodeLocation(available.identity.workspaceNodeId, available, edit.parentNodeId) !== "active") {
        throw new Error("Node Original parent is absent from the current Projection");
      }
      return expandEditAction(edit);
    case "node-delete":
      return singleAuthoredActionBatch({ kind: "node-trash", nodeId: edit.nodeId });
    case "node-restore":
      return prepareNodeRestore(edit, available);
    case "reference-promote":
      return singleAuthoredActionBatch(prepareReferencePromotion(edit.occurrenceId, available));
    case "occurrence-create":
    case "occurrence-restore":
      return singleAuthoredActionBatch({
        kind: "placement-create",
        placementId: edit.occurrenceId,
        nodeId: edit.nodeId,
        parentNodeId: edit.parentNodeId,
        anchor: edit.anchor,
      });
    case "occurrence-delete":
      return singleAuthoredActionBatch({ kind: "placement-remove", placementId: edit.occurrenceId });
    case "occurrence-move":
      return prepareOccurrenceMove(edit, available);
  }
}

export function assertNoWorkspaceCreation(workspaceId: string, operations: readonly EditAction[]): void {
  if (operations.some((operation) => operation.kind === "node-create" && operation.nodeId === workspaceId)) {
    throw new Error("Workspace identity is created only by Workspace genesis");
  }
}

function prepareNodeRestore(
  edit: Extract<StructuralEdit, { kind: "node-restore" }>,
  available: InterpretedProjection,
): AuthoredActionBatch {
  const occurrence = available.occurrences[edit.occurrenceId];
  if (
    nodeLocation(available.identity.workspaceNodeId, available, edit.nodeId) !== "trash" ||
    nodeLocation(available.identity.workspaceNodeId, available, edit.parentNodeId) !== "active" ||
    occurrence?.nodeId !== edit.nodeId
  ) {
    throw new Error("Restore target or destination context is absent");
  }
  return singleAuthoredActionBatch({
    kind: "node-restore",
    nodeId: edit.nodeId,
    placementId: edit.occurrenceId,
    parentNodeId: edit.parentNodeId,
    anchor: edit.anchor,
  });
}

function prepareOccurrenceMove(
  edit: Extract<StructuralEdit, { kind: "occurrence-move" }>,
  available: InterpretedProjection,
): AuthoredActionBatch {
  const field = Object.values(available.materializedFields)
    .flat()
    .find((candidate) => candidate.valueOccurrenceIds.includes(edit.occurrenceId));
  if (field !== undefined && edit.parentNodeId !== field.fieldNodeId) {
    throw new Error("Field Values can only be reordered within their Field");
  }
  return singleAuthoredActionBatch({
    kind: "placement-move",
    placementId: edit.occurrenceId,
    parentNodeId: edit.parentNodeId,
    anchor: edit.anchor,
  });
}

function prepareReferencePromotion(occurrenceId: string, available: InterpretedProjection): GraphAction {
  const occurrence = available.occurrences[occurrenceId];
  if (!occurrence) {
    throw new Error("Reference promotion target is absent from the current Projection");
  }
  if (available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId) {
    throw new Error("Reference promotion target is already the Original Occurrence");
  }
  return {
    kind: "original-promote",
    nodeId: occurrence.nodeId,
    placementId: occurrence.occurrenceId,
  };
}

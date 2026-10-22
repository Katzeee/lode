import type { EditAction } from "../../../domain/edit/index.js";
import type { GraphAction } from "../../../domain/fact/index.js";
import type { InterpretedProjection } from "../../../domain/reconcile/index.js";
import { singleAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";
import { EditPlanningRejection } from "./planning-rejection.js";

const STRUCTURAL_EDIT_KINDS = ["reference-promote", "occurrence-move"] as const satisfies readonly EditAction["kind"][];

type StructuralEdit = Extract<EditAction, { kind: (typeof STRUCTURAL_EDIT_KINDS)[number] }>;

export function isStructuralEdit(edit: EditAction): edit is StructuralEdit {
  return (STRUCTURAL_EDIT_KINDS as readonly EditAction["kind"][]).includes(edit.kind);
}

export function prepareStructuralEdit(edit: StructuralEdit, available: InterpretedProjection): AuthoredActionBatch {
  switch (edit.kind) {
    case "reference-promote":
      return singleAuthoredActionBatch(prepareReferencePromotion(edit.occurrenceId, available));
    case "occurrence-move":
      return singleAuthoredActionBatch({
        kind: "placement-move",
        placementId: edit.occurrenceId,
        parentNodeId: edit.parentNodeId,
        anchor: edit.anchor,
      });
  }
}

function prepareReferencePromotion(occurrenceId: string, available: InterpretedProjection): GraphAction {
  const occurrence = available.occurrences[occurrenceId];
  if (!occurrence) {
    throw new EditPlanningRejection("Reference promotion target is absent from the current Projection");
  }
  if (available.nodeOwners[occurrence.nodeId] === occurrence.parentNodeId) {
    throw new EditPlanningRejection("Reference promotion target is already the Original Occurrence");
  }
  return {
    kind: "original-promote",
    nodeId: occurrence.nodeId,
    placementId: occurrence.occurrenceId,
  };
}

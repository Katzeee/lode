import { graphActionKindsInFamily, type FieldContentRemovalAction, type FieldAction } from "../fact/index.js";
import { materializedFieldProblem, type InterpretedProjection } from "../reconcile/index.js";
import { AuthoredIntentViolation, type AuthoredIntentContext, type AuthoredIntentFamily } from "./contract.js";

const FIELD_ACTION_KINDS = graphActionKindsInFamily("field");

export const fieldAuthoredIntent = {
  key: "field",
  actionKinds: FIELD_ACTION_KINDS,
  assert: assertFieldAuthoredIntent,
} satisfies AuthoredIntentFamily<(typeof FIELD_ACTION_KINDS)[number]>;

function assertFieldAuthoredIntent(action: FieldAction, context: AuthoredIntentContext): void {
  const { available, resulting } = context;
  switch (action.kind) {
    case "field-materialize":
      rejectMaterializedFieldProblem(materializedFieldProblem(action, resulting));
      return;
    case "field-value-remove":
    case "materialized-field-clear":
      assertFieldContentRemoval(action, available);
      return;
    default:
      action satisfies never;
  }
}

function assertFieldContentRemoval(action: FieldContentRemovalAction, available: InterpretedProjection): void {
  const field =
    action.kind === "field-value-remove"
      ? Object.values(available.materializedFields)
          .flat()
          .find((candidate) => candidate.valueOccurrenceIds.includes(action.valuePlacementId))
      : available.materializedFields[action.ownerNodeId]?.find(
          (candidate) => candidate.fieldDefinitionId === action.fieldDefinitionId,
        );
  if (!field) {
    throw new AuthoredIntentViolation("Field content deletion target does not match the observed Materialized Field");
  }
  const occurrenceId = action.kind === "field-value-remove" ? action.valuePlacementId : field.fieldOccurrenceId;
  if (!available.occurrences[occurrenceId]) {
    throw new AuthoredIntentViolation("Field content deletion Occurrence is absent from the observed projection");
  }
}

function rejectMaterializedFieldProblem(problem: string | null): void {
  if (problem !== null) {
    throw new AuthoredIntentViolation(problem);
  }
}

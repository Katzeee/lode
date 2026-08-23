import type { FieldContentRemovalAction, FieldAction } from "../fact/index.js";
import { assertMaterializedField, type ScopedProjection } from "../reconcile/index.js";
import type { AuthoredIntentContext, AuthoredIntentFamily } from "./policy.js";

const FIELD_ACTION_KINDS = [
  "field-materialize",
  "field-value-remove",
  "materialized-field-clear",
] as const satisfies readonly FieldAction["kind"][];

export const fieldAuthoredIntent = {
  key: "field",
  actionKinds: FIELD_ACTION_KINDS,
  validate: validateFieldAuthoredIntent,
} satisfies AuthoredIntentFamily<(typeof FIELD_ACTION_KINDS)[number]>;

function validateFieldAuthoredIntent(action: FieldAction, context: AuthoredIntentContext): FieldAction {
  const { available, resulting } = context.projections();
  switch (action.kind) {
    case "field-materialize":
      assertMaterializedField(action, resulting);
      return action;
    case "field-value-remove":
    case "materialized-field-clear":
      return validateFieldContentRemoval(action, available);
  }
}

function validateFieldContentRemoval(
  action: FieldContentRemovalAction,
  available: ScopedProjection,
): FieldContentRemovalAction {
  const field =
    action.kind === "field-value-remove"
      ? Object.values(available.materializedFields)
          .flat()
          .find((candidate) => candidate.valueOccurrenceIds.includes(action.valuePlacementId))
      : available.materializedFields[action.ownerNodeId]?.find(
          (candidate) => candidate.fieldDefinitionId === action.fieldDefinitionId,
        );
  if (!field) {
    throw new Error("Field content deletion target does not match the observed Materialized Field");
  }
  const occurrenceId = action.kind === "field-value-remove" ? action.valuePlacementId : field.fieldOccurrenceId;
  if (!available.occurrences[occurrenceId]) {
    throw new Error("Field content deletion Occurrence is absent from the observed projection");
  }
  return action;
}

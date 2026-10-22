import { canonicalJson, materializedFieldNodeId, materializedFieldOccurrenceId } from "../fact/index.js";
import { impactAddress, type InterpretedProjection, type InterpretedProjectionGeneration } from "../reconcile/index.js";
import { defineReviewFamily, type ReviewFact } from "./review-family.js";
import type { FieldMaterializationDecisionEffect } from "./types.js";
import { associatedNodeScope, fieldContentRemovalScopes, reviewScope } from "./review-scope.js";

const FIELD_MATERIALIZATION_ACTION_KINDS = ["field-materialize", "materialized-field-clear"] as const;

type MaterializationFact = ReviewFact<(typeof FIELD_MATERIALIZATION_ACTION_KINDS)[number]>;

export const fieldMaterializationReviewFamily = defineReviewFamily<
  (typeof FIELD_MATERIALIZATION_ACTION_KINDS)[number],
  string,
  FieldMaterializationDecisionEffect
>({
  key: "field-materialization",
  actionKinds: FIELD_MATERIALIZATION_ACTION_KINDS,
  scopes(fact, context) {
    const action = fact.action;
    if (action.kind === "materialized-field-clear") {
      return fieldContentRemovalScopes(action, context);
    }
    return [
      reviewScope("materialized-field", action.ownerNodeId, action.fieldDefinitionId),
      associatedNodeScope(action.ownerNodeId),
      associatedNodeScope(action.fieldDefinitionId),
      associatedNodeScope(materializedFieldNodeId(action.ownerNodeId, action.fieldDefinitionId)),
    ];
  },
  identify: (fact) => materializedFieldAddress(fact.action.ownerNodeId, fact.action.fieldDefinitionId),
  effect: (fact, _identity, generation) => fieldMaterializationEffect(fact, generation),
  changed: (effect) => effect.originFieldNodeId !== effect.reviewFieldNodeId,
  diffKind: "materialized-field",
  effectIdentity: (_identity, effect) =>
    canonicalJson(["field-materialization", effect.ownerNodeId, effect.fieldDefinitionId]),
  addImpacts(impacts, targets) {
    for (const fact of targets) {
      const action = fact.action;
      if (action.kind === "field-materialize") {
        impacts.add(materializedFieldAddress(action.ownerNodeId, action.fieldDefinitionId));
        impacts.add(materializedFieldNodeId(action.ownerNodeId, action.fieldDefinitionId));
        impacts.add(materializedFieldOccurrenceId(action.ownerNodeId, action.fieldDefinitionId));
      }
    }
  },
});

function fieldMaterializationEffect(
  fact: MaterializationFact,
  generation: InterpretedProjectionGeneration,
): FieldMaterializationDecisionEffect {
  const action = fact.action;
  const origin = materializedField(generation.origin, action.ownerNodeId, action.fieldDefinitionId);
  const review = materializedField(generation.review, action.ownerNodeId, action.fieldDefinitionId);
  return {
    kind: "field-materialization",
    ownerNodeId: action.ownerNodeId,
    fieldDefinitionId: action.fieldDefinitionId,
    originFieldNodeId: origin?.fieldNodeId ?? null,
    reviewFieldNodeId: review?.fieldNodeId ?? null,
    originFieldOccurrenceId: origin?.fieldOccurrenceId ?? null,
    reviewFieldOccurrenceId: review?.fieldOccurrenceId ?? null,
  };
}

function materializedFieldAddress(ownerNodeId: string, fieldDefinitionId: string): string {
  return impactAddress("materialized-field", ownerNodeId, fieldDefinitionId);
}

function materializedField(projection: InterpretedProjection, ownerNodeId: string, fieldDefinitionId: string) {
  return projection.materializedFields[ownerNodeId]?.find((field) => field.fieldDefinitionId === fieldDefinitionId);
}

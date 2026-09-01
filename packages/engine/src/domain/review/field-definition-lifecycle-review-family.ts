import { canonicalJson, isFieldDefinitionAction, type FactAction } from "../fact/index.js";
import type { InterpretedProjectionGeneration } from "../reconcile/index.js";
import { defineReviewFamily } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import type { OwnerDecisionEffect } from "./types.js";

const ACTION_KINDS = ["field-definition-make-discoverable", "field-definition-return-to-template-field"] as const;

export const fieldDefinitionLifecycleReviewFamily = defineReviewFamily<
  (typeof ACTION_KINDS)[number],
  string,
  OwnerDecisionEffect
>({
  key: "field-definition-lifecycle",
  actionKinds: ACTION_KINDS,
  scopes(fact) {
    const action = fact.action;
    return [
      reviewScope("field-definition-owner", action.fieldDefinitionId),
      associatedNodeScope(action.fieldDefinitionId),
    ];
  },
  identify: (fact) => fact.action.fieldDefinitionId,
  effect: (_fact, fieldDefinitionId, generation) => ownerEffect(fieldDefinitionId, generation),
  changed: (effect) => effect.origin !== effect.review,
  diffKind: "owner",
  effectIdentity: (_fieldDefinitionId, effect) => canonicalJson(effect),
  addImpacts(impacts, targets) {
    for (const fact of targets) {
      if (isLifecycleAction(fact.action)) {
        impacts.add(fact.action.fieldDefinitionId);
      }
    }
  },
});

function ownerEffect(fieldDefinitionId: string, generation: InterpretedProjectionGeneration): OwnerDecisionEffect {
  return {
    kind: "owner",
    identity: fieldDefinitionId,
    origin: generation.origin.nodeOwners[fieldDefinitionId] ?? null,
    review: generation.review.nodeOwners[fieldDefinitionId] ?? null,
  };
}

function isLifecycleAction(
  action: FactAction["action"],
): action is Extract<FactAction["action"], { kind: (typeof ACTION_KINDS)[number] }> {
  return isFieldDefinitionAction(action) && action.kind !== "field-configuration-set";
}

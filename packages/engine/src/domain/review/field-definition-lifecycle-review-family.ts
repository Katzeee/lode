import { canonicalJson, compareCausalOrder, isFieldDefinitionAction, type FactAction } from "../fact/index.js";
import type { InterpretedProjectionGeneration } from "../reconcile/index.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import type { OwnerDecisionEffect } from "./types.js";

const ACTION_KINDS = ["field-definition-make-discoverable", "field-definition-return-to-template-field"] as const;

export const fieldDefinitionLifecycleReviewFamily = {
  key: "field-definition-lifecycle",
  actionKinds: ACTION_KINDS,
  scopes(fact) {
    const action = fact.action;
    if (!isLifecycleAction(action)) {
      throw new Error("Field Definition lifecycle Review family received another action");
    }
    return [
      reviewScope("field-definition-owner", action.fieldDefinitionId),
      associatedNodeScope(action.fieldDefinitionId),
    ];
  },
  candidates: ({ generation, pending }) => candidates(generation, pending),
  effect(fact, _targets, generation) {
    const action = fact.action;
    if (!isLifecycleAction(action)) {
      throw new Error("Field Definition lifecycle Review family received another action");
    }
    const effect = ownerEffect(action.fieldDefinitionId, generation);
    return effect.origin === effect.review ? null : { identity: canonicalJson(effect), effect };
  },
  addImpacts(impacts, targets) {
    for (const fact of targets) {
      if (isLifecycleAction(fact.action)) {
        impacts.add(fact.action.fieldDefinitionId);
      }
    }
  },
} satisfies ReviewFamilyRule;

function candidates(
  generation: InterpretedProjectionGeneration,
  pending: ReadonlyMap<FactAction["id"], FactAction>,
): readonly HunkCandidate[] {
  const groups = new Map<string, FactAction[]>();
  for (const fact of pending.values()) {
    if (!isLifecycleAction(fact.action)) {
      continue;
    }
    const values = groups.get(fact.action.fieldDefinitionId) ?? [];
    values.push(fact);
    groups.set(fact.action.fieldDefinitionId, values);
  }
  return [...groups].flatMap(([fieldDefinitionId, facts]): readonly HunkCandidate[] => {
    const effect = ownerEffect(fieldDefinitionId, generation);
    return effect.origin === effect.review
      ? []
      : [
          {
            diffSpace: { kind: "owner", identity: fieldDefinitionId },
            targets: [...facts].sort(compareCausalOrder).map((fact) => fact.id),
            bridges: [],
          },
        ];
  });
}

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

import { canonicalJson, compareCausalOrder, type FactAction } from "../fact/index.js";
import { impactAddress, type ScopedProjection, type ScopedProjectionGeneration } from "../reconcile/index.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import type { FieldMaterializationDecisionEffect } from "./types.js";
import { associatedNodeScope, fieldContentRemovalScopes, reviewScope } from "./review-scope.js";

const FIELD_MATERIALIZATION_ACTION_KINDS = ["field-materialize", "materialized-field-clear"] as const;

export const fieldMaterializationReviewFamily = {
  key: "field-materialization",
  actionKinds: FIELD_MATERIALIZATION_ACTION_KINDS,
  scopes(fact, context) {
    const action = fact.action;
    if (!isFieldMaterializationAction(action)) {
      throw new Error("Field materialization Review family received another AuthoredAction family");
    }
    if (action.kind === "materialized-field-clear") {
      return fieldContentRemovalScopes(action, context);
    }
    return [
      reviewScope("materialized-field", action.ownerNodeId, action.fieldDefinitionId),
      associatedNodeScope(action.ownerNodeId),
      associatedNodeScope(action.fieldDefinitionId),
      associatedNodeScope(action.fieldNodeId),
    ];
  },
  candidates: ({ generation, pending }) => materializedFieldCandidates(generation, pending),
  effect(fact, _targets, generation) {
    const action = fact.action;
    if (!isFieldMaterializationAction(action)) {
      throw new Error("Field materialization Review family received another AuthoredAction family");
    }
    const effect = fieldMaterializationEffect(fact, generation);
    return effect.originFieldNodeId === effect.reviewFieldNodeId
      ? null
      : {
          identity: canonicalJson(["field-materialization", effect.ownerNodeId, effect.fieldDefinitionId]),
          effect,
        };
  },
  addImpacts(impacts, targets) {
    for (const fact of targets) {
      const action = fact.action;
      if (action.kind === "field-materialize") {
        impacts.add(materializedFieldAddress(action.ownerNodeId, action.fieldDefinitionId));
        impacts.add(action.fieldNodeId);
        impacts.add(action.fieldOccurrenceId);
      }
    }
  },
} satisfies ReviewFamilyRule;

function materializedFieldCandidates(
  generation: ScopedProjectionGeneration,
  pending: ReadonlyMap<FactAction["id"], FactAction>,
): readonly HunkCandidate[] {
  const groups = new Map<string, FactAction[]>();
  for (const fact of pending.values()) {
    const action = fact.action;
    if (!isFieldMaterializationAction(action)) {
      continue;
    }
    const address = materializedFieldAddress(action.ownerNodeId, action.fieldDefinitionId);
    const group = groups.get(address) ?? [];
    group.push(fact);
    groups.set(address, group);
  }
  return [...groups.entries()].flatMap(([address, facts]) => {
    const effect = fieldMaterializationEffect(facts.at(-1)!, generation);
    return canonicalJson(effect.originFieldNodeId) === canonicalJson(effect.reviewFieldNodeId)
      ? []
      : [
          {
            diffSpace: { kind: "materialized-field" as const, identity: address },
            targets: [...facts].sort(compareCausalOrder).map((fact) => fact.id),
            bridges: [],
          },
        ];
  });
}

function fieldMaterializationEffect(
  fact: FactAction,
  generation: ScopedProjectionGeneration,
): FieldMaterializationDecisionEffect {
  const action = fact.action;
  if (!isFieldMaterializationAction(action)) {
    throw new Error("Field materialization effect requires a Field materialization AuthoredAction");
  }
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

function materializedField(projection: ScopedProjection, ownerNodeId: string, fieldDefinitionId: string) {
  return projection.materializedFields[ownerNodeId]?.find((field) => field.fieldDefinitionId === fieldDefinitionId);
}

function isFieldMaterializationAction(
  action: FactAction["action"],
): action is Extract<FactAction["action"], { kind: (typeof FIELD_MATERIALIZATION_ACTION_KINDS)[number] }> {
  return FIELD_MATERIALIZATION_ACTION_KINDS.includes(
    action.kind as (typeof FIELD_MATERIALIZATION_ACTION_KINDS)[number],
  );
}

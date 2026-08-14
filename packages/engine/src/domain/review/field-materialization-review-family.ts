import { canonicalJson, compareFacts, type ContributionFact } from "../fact/index.js";
import {
  impactAddress,
  type ScopedProjection,
  type ScopedProjectionGeneration,
} from "../reconcile/index.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import type { FieldMaterializationDecisionEffect } from "./types.js";

const FIELD_MATERIALIZATION_MUTATION_KINDS = [
  "field-materialize",
  "materialized-field-delete",
  "field-initialize",
] as const;

export const fieldMaterializationReviewFamily = {
  key: "field-materialization",
  mutationKinds: FIELD_MATERIALIZATION_MUTATION_KINDS,
  candidates: ({ generation, pending }) => materializedFieldCandidates(generation, pending),
  effect(fact, _targets, generation) {
    const mutation = fact.body.mutation;
    if (!isFieldMaterializationMutation(mutation)) {
      throw new Error("Field materialization Review family received another Mutation family");
    }
    const effect = fieldMaterializationEffect(fact, generation);
    return effect.originFieldNodeId === effect.reviewFieldNodeId
      ? null
      : {
          identity: canonicalJson([
            "field-materialization",
            effect.ownerNodeId,
            effect.fieldDefinitionId,
          ]),
          effect,
        };
  },
  addImpacts(impacts, targets) {
    for (const fact of targets) {
      const mutation = fact.body.mutation;
      if (mutation.kind === "field-materialize" || mutation.kind === "field-initialize") {
        impacts.add(materializedFieldAddress(mutation.ownerNodeId, mutation.fieldDefinitionId));
        if (mutation.kind === "field-materialize") {
          impacts.add(mutation.fieldNodeId);
          impacts.add(mutation.fieldOccurrenceId);
        }
      }
    }
  },
} satisfies ReviewFamilyRule;

function materializedFieldCandidates(
  generation: ScopedProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const groups = new Map<string, ContributionFact[]>();
  for (const fact of pending.values()) {
    const mutation = fact.body.mutation;
    if (!isFieldMaterializationMutation(mutation)) {
      continue;
    }
    const address = materializedFieldAddress(mutation.ownerNodeId, mutation.fieldDefinitionId);
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
            targets: [...facts].sort(compareFacts).map((fact) => fact.id),
            bridges: [],
          },
        ];
  });
}

function fieldMaterializationEffect(
  fact: ContributionFact,
  generation: ScopedProjectionGeneration,
): FieldMaterializationDecisionEffect {
  const mutation = fact.body.mutation;
  if (!isFieldMaterializationMutation(mutation)) {
    throw new Error("Field materialization effect requires a Field materialization Mutation");
  }
  const origin = materializedField(
    generation.origin,
    mutation.ownerNodeId,
    mutation.fieldDefinitionId,
  );
  const review = materializedField(
    generation.review,
    mutation.ownerNodeId,
    mutation.fieldDefinitionId,
  );
  return {
    kind: "field-materialization",
    ownerNodeId: mutation.ownerNodeId,
    fieldDefinitionId: mutation.fieldDefinitionId,
    originFieldNodeId: origin?.fieldNodeId ?? null,
    reviewFieldNodeId: review?.fieldNodeId ?? null,
    originFieldOccurrenceId: origin?.fieldOccurrenceId ?? null,
    reviewFieldOccurrenceId: review?.fieldOccurrenceId ?? null,
  };
}

function materializedFieldAddress(ownerNodeId: string, fieldDefinitionId: string): string {
  return impactAddress("materialized-field", ownerNodeId, fieldDefinitionId);
}

function materializedField(
  projection: ScopedProjection,
  ownerNodeId: string,
  fieldDefinitionId: string,
) {
  return projection.materializedFields[ownerNodeId]?.find(
    (field) => field.fieldDefinitionId === fieldDefinitionId,
  );
}

function isFieldMaterializationMutation(
  mutation: ContributionFact["body"]["mutation"],
): mutation is Extract<
  ContributionFact["body"]["mutation"],
  { kind: (typeof FIELD_MATERIALIZATION_MUTATION_KINDS)[number] }
> {
  return FIELD_MATERIALIZATION_MUTATION_KINDS.includes(
    mutation.kind as (typeof FIELD_MATERIALIZATION_MUTATION_KINDS)[number],
  );
}

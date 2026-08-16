import {
  canonicalJson,
  compareFacts,
  isSupertagMutation,
  type ContributionFact,
  type SupertagMutation,
} from "../fact/index.js";
import type { ScopedProjection, ScopedProjectionGeneration } from "../reconcile/index.js";
import type { HunkCandidate } from "./review-family.js";
import { supertagRelationAddress, supertagRelationEffect } from "./supertag-review.js";
import type { FieldConfigurationDecisionEffect } from "./types.js";

export function supertagCandidates(
  generation: ScopedProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const groups = new Map<string, ContributionFact[]>();
  for (const fact of pending.values()) {
    const mutation = fact.body.mutation;
    if (!isSupertagMutation(mutation)) {
      continue;
    }
    const address = supertagRelationAddress(mutation);
    const groupAddress =
      mutation.kind === "supertag-field-configure" ? `${address}/configuration` : `${address}/relation`;
    const group = groups.get(groupAddress) ?? [];
    group.push(fact);
    groups.set(groupAddress, group);
  }
  return [...groups.values()].flatMap((facts): readonly HunkCandidate[] => candidateForGroup(facts, generation));
}

export function fieldConfigurationEffect(
  fact: ContributionFact,
  generation: ScopedProjectionGeneration,
): FieldConfigurationDecisionEffect {
  const mutation = fact.body.mutation;
  if (mutation.kind !== "supertag-field-configure") {
    throw new Error("Field configuration effect requires a Field configuration Mutation");
  }
  return {
    kind: "field-configuration",
    supertagId: mutation.supertagId,
    fieldDefinitionId: mutation.fieldDefinitionId,
    origin: fieldConfiguration(generation.origin, mutation.supertagId, mutation.fieldDefinitionId),
    review: fieldConfiguration(generation.review, mutation.supertagId, mutation.fieldDefinitionId),
  };
}

function candidateForGroup(
  facts: readonly ContributionFact[],
  generation: ScopedProjectionGeneration,
): readonly HunkCandidate[] {
  const last = facts.at(-1)!;
  const mutation = last.body.mutation;
  if (mutation.kind === "supertag-field-configure") {
    const effect = fieldConfigurationEffect(last, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? []
      : [
          {
            diffSpace: {
              kind: "field-configuration",
              identity: supertagRelationAddress(mutation),
            },
            targets: [...facts].sort(compareFacts).map((fact) => fact.id),
            bridges: [],
          },
        ];
  }
  const supertagFact = supertagMutationFact(last);
  const effect = supertagRelationEffect(supertagFact, generation);
  return effect.originIndex === effect.reviewIndex
    ? []
    : [
        {
          diffSpace: {
            kind: effect.relation === "application" ? "supertag-application" : "supertag-template",
            identity: supertagRelationAddress(supertagFact.body.mutation),
          },
          targets: [...facts].sort(compareFacts).map((fact) => fact.id),
          bridges: [],
        },
      ];
}

function fieldConfiguration(projection: ScopedProjection, supertagId: string, fieldDefinitionId: string) {
  return (
    projection.templateFields[supertagId]?.find((item) => item.fieldDefinitionId === fieldDefinitionId)
      ?.effectiveConfig ?? null
  );
}

type SupertagMutationFact = ContributionFact & Readonly<{ body: Readonly<{ mutation: SupertagMutation }> }>;

function supertagMutationFact(fact: ContributionFact): SupertagMutationFact {
  if (!isSupertagMutation(fact.body.mutation)) {
    throw new Error("Supertag Review group contains a non-Supertag Mutation");
  }
  return fact as SupertagMutationFact;
}

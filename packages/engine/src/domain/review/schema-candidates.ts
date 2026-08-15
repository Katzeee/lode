import {
  canonicalJson,
  compareFacts,
  isSchemaMutation,
  type ContributionFact,
  type SchemaMutation,
} from "../fact/index.js";
import type { ScopedProjection, ScopedProjectionGeneration } from "../reconcile/index.js";
import type { HunkCandidate } from "./review-family.js";
import { schemaRelationAddress, schemaRelationEffect } from "./schema-review.js";
import type { FieldConfigurationDecisionEffect } from "./types.js";

export function schemaCandidates(
  generation: ScopedProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const groups = new Map<string, ContributionFact[]>();
  for (const fact of pending.values()) {
    const mutation = fact.body.mutation;
    if (!isSchemaMutation(mutation)) {
      continue;
    }
    const address = schemaRelationAddress(mutation);
    const groupAddress =
      mutation.kind === "schema-field-configure" ? `${address}/configuration` : `${address}/relation`;
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
  if (mutation.kind !== "schema-field-configure") {
    throw new Error("Field configuration effect requires a Field configuration Mutation");
  }
  return {
    kind: "field-configuration",
    schemaId: mutation.schemaId,
    fieldDefinitionId: mutation.fieldDefinitionId,
    origin: fieldConfiguration(generation.origin, mutation.schemaId, mutation.fieldDefinitionId),
    review: fieldConfiguration(generation.review, mutation.schemaId, mutation.fieldDefinitionId),
  };
}

function candidateForGroup(
  facts: readonly ContributionFact[],
  generation: ScopedProjectionGeneration,
): readonly HunkCandidate[] {
  const last = facts.at(-1)!;
  const mutation = last.body.mutation;
  if (mutation.kind === "schema-field-configure") {
    const effect = fieldConfigurationEffect(last, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? []
      : [
          {
            diffSpace: {
              kind: "field-configuration",
              identity: schemaRelationAddress(mutation),
            },
            targets: [...facts].sort(compareFacts).map((fact) => fact.id),
            bridges: [],
          },
        ];
  }
  const schemaFact = schemaMutationFact(last);
  const effect = schemaRelationEffect(schemaFact, generation);
  return effect.originIndex === effect.reviewIndex
    ? []
    : [
        {
          diffSpace: {
            kind: effect.relation === "application" ? "schema-application" : "schema-template",
            identity: schemaRelationAddress(schemaFact.body.mutation),
          },
          targets: [...facts].sort(compareFacts).map((fact) => fact.id),
          bridges: [],
        },
      ];
}

function fieldConfiguration(projection: ScopedProjection, schemaId: string, fieldDefinitionId: string) {
  return (
    projection.templateFields[schemaId]?.find((item) => item.fieldDefinitionId === fieldDefinitionId)
      ?.effectiveConfig ?? null
  );
}

type SchemaMutationFact = ContributionFact & Readonly<{ body: Readonly<{ mutation: SchemaMutation }> }>;

function schemaMutationFact(fact: ContributionFact): SchemaMutationFact {
  if (!isSchemaMutation(fact.body.mutation)) {
    throw new Error("Schema Review group contains a non-Schema Mutation");
  }
  return fact as SchemaMutationFact;
}

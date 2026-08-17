import { canonicalJson, compareFacts, isFieldDefinitionConfigMutation, type ContributionFact } from "../fact/index.js";
import type { FieldDefinitionConfiguration, ScopedProjection, ScopedProjectionGeneration } from "../reconcile/index.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import type { FieldDefinitionConfigurationDecisionEffect, FieldDefinitionConfigurationDecisionState } from "./types.js";

const MUTATION_KINDS = [
  "field-datatype-configure",
  "field-cardinality-configure",
  "field-optionality-configure",
  "field-initialization-expression-configure",
] as const;

export const fieldDefinitionConfigurationReviewFamily = {
  key: "field-definition-configuration",
  mutationKinds: MUTATION_KINDS,
  scopes(fact) {
    const mutation = fact.body.mutation;
    if (!isFieldDefinitionConfigMutation(mutation)) {
      throw new Error("Field Definition configuration Review family received another Mutation family");
    }
    return [
      reviewScope("field-definition-configuration", mutation.configurationNodeId),
      associatedNodeScope(mutation.configurationNodeId),
      associatedNodeScope(mutation.fieldDefinitionId),
    ];
  },
  candidates: ({ generation, pending }) => candidates(generation, pending),
  effect(fact, _targets, generation) {
    const mutation = fact.body.mutation;
    if (!isFieldDefinitionConfigMutation(mutation)) {
      throw new Error("Field Definition configuration Review family received another Mutation family");
    }
    const effect = configurationEffect(mutation.fieldDefinitionId, mutation.configurationNodeId, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? null
      : { identity: `field-definition-configuration/${mutation.configurationNodeId}`, effect };
  },
  addImpacts(impacts, targets) {
    for (const fact of targets) {
      const mutation = fact.body.mutation;
      if (isFieldDefinitionConfigMutation(mutation)) {
        impacts.add(mutation.fieldDefinitionId);
        impacts.add(mutation.configurationNodeId);
      }
    }
  },
} satisfies ReviewFamilyRule;

function candidates(
  generation: ScopedProjectionGeneration,
  pending: ReadonlyMap<string, ContributionFact>,
): readonly HunkCandidate[] {
  const groups = new Map<string, ContributionFact[]>();
  for (const fact of pending.values()) {
    const mutation = fact.body.mutation;
    if (!isFieldDefinitionConfigMutation(mutation)) {
      continue;
    }
    const key = `${mutation.fieldDefinitionId}\u0000${mutation.configurationNodeId}`;
    const facts = groups.get(key) ?? [];
    facts.push(fact);
    groups.set(key, facts);
  }
  return [...groups.values()].flatMap((facts) => {
    const mutation = facts[0]?.body.mutation;
    if (!mutation || !isFieldDefinitionConfigMutation(mutation)) {
      return [];
    }
    const effect = configurationEffect(mutation.fieldDefinitionId, mutation.configurationNodeId, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? []
      : [
          {
            diffSpace: {
              kind: "field-definition-configuration" as const,
              identity: mutation.configurationNodeId,
            },
            targets: [...facts].sort(compareFacts).map((fact) => fact.id),
            bridges: [],
          },
        ];
  });
}

function configurationEffect(
  fieldDefinitionId: string,
  configurationNodeId: string,
  generation: ScopedProjectionGeneration,
): FieldDefinitionConfigurationDecisionEffect {
  return {
    kind: "field-definition-configuration",
    fieldDefinitionId,
    configurationNodeId,
    origin: configurationState(fieldDefinitionId, configurationNodeId, generation.origin),
    review: configurationState(fieldDefinitionId, configurationNodeId, generation.review),
  };
}

function configurationState(
  fieldDefinitionId: string,
  configurationNodeId: string,
  projection: ScopedProjection,
): FieldDefinitionConfigurationDecisionState | null {
  const configuration = (projection.fieldDefinitionConfigurations[fieldDefinitionId] ?? []).find(
    (candidate) => candidate.configurationNodeId === configurationNodeId,
  );
  return configuration ? decisionState(configuration) : null;
}

function decisionState(configuration: FieldDefinitionConfiguration): FieldDefinitionConfigurationDecisionState {
  if (configuration.kind === "datatype") {
    return {
      kind: configuration.kind,
      datatypeNodeId: configuration.datatypeNodeId,
    };
  }
  if (configuration.kind === "cardinality") {
    return {
      kind: configuration.kind,
      cardinalityNodeId: configuration.cardinalityNodeId,
    };
  }
  if (configuration.kind === "optionality") {
    return {
      kind: configuration.kind,
      optionalityNodeId: configuration.optionalityNodeId,
    };
  }
  return { kind: configuration.kind, expression: configuration.expression };
}

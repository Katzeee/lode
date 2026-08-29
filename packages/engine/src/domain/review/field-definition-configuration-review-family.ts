import { canonicalJson, compareCausalOrder, isFieldDefinitionConfigAction, type FactAction } from "../fact/index.js";
import {
  fieldConfigurationProjectionIdentity,
  type FieldDefinitionConfiguration,
  type InterpretedProjection,
  type InterpretedProjectionGeneration,
} from "../reconcile/index.js";
import type { HunkCandidate, ReviewFamilyRule } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import type { FieldDefinitionConfigurationDecisionEffect, FieldDefinitionConfigurationDecisionState } from "./types.js";

const ACTION_KINDS = ["field-configuration-set"] as const;

export const fieldDefinitionConfigurationReviewFamily = {
  key: "field-definition-configuration",
  actionKinds: ACTION_KINDS,
  scopes(fact) {
    const action = fact.action;
    if (!isFieldDefinitionConfigAction(action)) {
      throw new Error("Field Definition configuration Review family received another AuthoredAction family");
    }
    const identity = configurationIdentity(action.fieldDefinitionId, action.configuration.kind);
    return [reviewScope("field-definition-configuration", identity), associatedNodeScope(action.fieldDefinitionId)];
  },
  candidates: ({ generation, pending }) => candidates(generation, pending),
  effect(fact, _targets, generation) {
    const action = fact.action;
    if (!isFieldDefinitionConfigAction(action)) {
      throw new Error("Field Definition configuration Review family received another AuthoredAction family");
    }
    const effect = configurationEffect(action.fieldDefinitionId, action.configuration.kind, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? null
      : { identity: configurationIdentity(action.fieldDefinitionId, action.configuration.kind), effect };
  },
  addImpacts(impacts, targets) {
    for (const fact of targets) {
      const action = fact.action;
      if (isFieldDefinitionConfigAction(action)) {
        impacts.add(action.fieldDefinitionId);
        impacts.add(
          fieldConfigurationProjectionIdentity(action.fieldDefinitionId, action.configuration).configurationNodeId,
        );
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
    const action = fact.action;
    if (!isFieldDefinitionConfigAction(action)) {
      continue;
    }
    const key = configurationIdentity(action.fieldDefinitionId, action.configuration.kind);
    const facts = groups.get(key) ?? [];
    facts.push(fact);
    groups.set(key, facts);
  }
  return [...groups.entries()].flatMap(([identity, facts]) => {
    const action = facts[0]?.action;
    if (!action || !isFieldDefinitionConfigAction(action)) {
      return [];
    }
    const effect = configurationEffect(action.fieldDefinitionId, action.configuration.kind, generation);
    return canonicalJson(effect.origin) === canonicalJson(effect.review)
      ? []
      : [
          {
            diffSpace: { kind: "field-definition-configuration" as const, identity },
            targets: [...facts].sort(compareCausalOrder).map((fact) => fact.id),
            bridges: [],
          },
        ];
  });
}

function configurationEffect(
  fieldDefinitionId: string,
  configurationKind: FieldDefinitionConfiguration["kind"],
  generation: InterpretedProjectionGeneration,
): FieldDefinitionConfigurationDecisionEffect {
  return {
    kind: "field-definition-configuration",
    fieldDefinitionId,
    configurationKind,
    origin: configurationState(fieldDefinitionId, configurationKind, generation.origin),
    review: configurationState(fieldDefinitionId, configurationKind, generation.review),
  };
}

function configurationState(
  fieldDefinitionId: string,
  configurationKind: FieldDefinitionConfiguration["kind"],
  projection: InterpretedProjection,
): FieldDefinitionConfigurationDecisionState | null {
  const configuration = (projection.fieldDefinitionConfigurations[fieldDefinitionId] ?? []).find(
    (candidate) => candidate.kind === configurationKind,
  );
  return configuration ? decisionState(configuration) : null;
}

function decisionState(configuration: FieldDefinitionConfiguration): FieldDefinitionConfigurationDecisionState {
  if (configuration.kind === "datatype") {
    return { kind: configuration.kind, datatypeNodeId: configuration.datatypeNodeId };
  }
  if (configuration.kind === "cardinality") {
    return { kind: configuration.kind, cardinalityNodeId: configuration.cardinalityNodeId };
  }
  if (configuration.kind === "optionality") {
    return { kind: configuration.kind, optionalityNodeId: configuration.optionalityNodeId };
  }
  return {
    kind: configuration.kind,
    expression: {
      kind: configuration.expression.kind,
      sourceFieldDefinitionId: configuration.expression.sourceFieldDefinitionId,
    },
  };
}

function configurationIdentity(fieldDefinitionId: string, kind: FieldDefinitionConfiguration["kind"]): string {
  return `${fieldDefinitionId}/${kind}`;
}

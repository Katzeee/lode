import { isFieldDefinitionConfigAction } from "../fact/index.js";
import {
  fieldConfigurationProjectionIdentity,
  type FieldDefinitionConfiguration,
  type InterpretedProjection,
  type InterpretedProjectionGeneration,
} from "../reconcile/index.js";
import { defineReviewFamily, originReviewChanged } from "./review-family.js";
import { associatedNodeScope, reviewScope } from "./review-scope.js";
import type { FieldDefinitionConfigurationDecisionEffect, FieldDefinitionConfigurationDecisionState } from "./types.js";

const ACTION_KINDS = ["field-configuration-set"] as const;

export const fieldDefinitionConfigurationReviewFamily = defineReviewFamily<
  (typeof ACTION_KINDS)[number],
  string,
  FieldDefinitionConfigurationDecisionEffect
>({
  key: "field-definition-configuration",
  actionKinds: ACTION_KINDS,
  scopes(fact) {
    const action = fact.action;
    const identity = configurationIdentity(action.fieldDefinitionId, action.configuration.kind);
    return [reviewScope("field-definition-configuration", identity), associatedNodeScope(action.fieldDefinitionId)];
  },
  identify: (fact) => configurationIdentity(fact.action.fieldDefinitionId, fact.action.configuration.kind),
  effect: (fact, _identity, generation) =>
    configurationEffect(fact.action.fieldDefinitionId, fact.action.configuration.kind, generation),
  changed: originReviewChanged,
  diffKind: "field-definition-configuration",
  effectIdentity: (identity) => identity,
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
});

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

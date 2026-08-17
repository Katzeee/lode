import type { DecisionEffect, FieldDefinitionConfigurationDecisionState } from "../domain/review/index.js";
import { exact, nonempty, object } from "../shape-validation/index.js";

export function fieldDefinitionConfigurationEffect(effect: Record<string, unknown>): DecisionEffect {
  exact(
    effect,
    ["kind", "fieldDefinitionId", "configurationNodeId", "origin", "review"],
    "Field Definition configuration Decision effect",
  );
  return {
    kind: "field-definition-configuration",
    fieldDefinitionId: nonempty(effect.fieldDefinitionId, "Field Definition identity"),
    configurationNodeId: nonempty(effect.configurationNodeId, "Field configuration Node identity"),
    origin: effect.origin === null ? null : fieldDefinitionConfigurationState(effect.origin),
    review: effect.review === null ? null : fieldDefinitionConfigurationState(effect.review),
  };
}

function fieldDefinitionConfigurationState(value: unknown): FieldDefinitionConfigurationDecisionState {
  const state = object(value, "Field Definition configuration state");
  const kind = nonempty(state.kind, "Field Definition configuration kind");
  if (kind === "datatype") {
    exact(state, ["kind", "datatypeNodeId"], "Field datatype state");
    return {
      kind,
      datatypeNodeId: nonempty(state.datatypeNodeId, "Field Datatype endpoint Node identity"),
    };
  }
  if (kind === "cardinality") {
    exact(state, ["kind", "cardinalityNodeId"], "Field cardinality state");
    return {
      kind,
      cardinalityNodeId: nonempty(state.cardinalityNodeId, "Field Cardinality endpoint Node identity"),
    };
  }
  if (kind !== "initialization-expression") {
    throw new Error(`Unknown Field Definition configuration kind: ${kind}`);
  }
  exact(state, ["kind", "expression"], "Field initialization expression state");
  const expression = object(state.expression, "Field initialization expression");
  exact(
    expression,
    [
      "kind",
      "expressionNodeId",
      "expressionOccurrenceId",
      "sourceFieldDefinitionId",
      "sourceFieldDefinitionOccurrenceId",
      "contextNodeId",
      "contextOccurrenceId",
    ],
    "Field initialization expression",
  );
  if (expression.kind !== "find-field-values") {
    throw new Error("Field initialization expression kind is invalid");
  }
  return {
    kind,
    expression: {
      kind: "find-field-values",
      expressionNodeId: nonempty(expression.expressionNodeId, "expression Node identity"),
      expressionOccurrenceId: nonempty(expression.expressionOccurrenceId, "expression Occurrence identity"),
      sourceFieldDefinitionId: nonempty(expression.sourceFieldDefinitionId, "source Field Definition identity"),
      sourceFieldDefinitionOccurrenceId: nonempty(
        expression.sourceFieldDefinitionOccurrenceId,
        "source Field Definition Occurrence identity",
      ),
      contextNodeId: nonempty(expression.contextNodeId, "context Node identity"),
      contextOccurrenceId: nonempty(expression.contextOccurrenceId, "context Occurrence identity"),
    },
  };
}

import { exact, nonempty, object } from "../../decoding/index.js";
import type { FieldDefinitionConfiguration } from "./projection-types.js";

export function parseFieldDefinitionConfiguration(value: unknown): FieldDefinitionConfiguration {
  const item = object(value, "Field Definition configuration");
  const base = {
    configurationNodeId: nonempty(item.configurationNodeId, "Field configuration Node identity"),
    configurationOccurrenceId: nonempty(item.configurationOccurrenceId, "Field configuration Occurrence identity"),
    definitionNodeId: nonempty(item.definitionNodeId, "Field configuration Definition Node identity"),
    contributionId: nonempty(item.contributionId, "Field configuration Contribution identity"),
  };
  if (item.kind === "datatype") {
    if (typeof item.datatypeNodeId !== "string" || item.datatypeNodeId.length === 0) {
      throw new Error("Field Datatype endpoint Node identity is invalid");
    }
    exact(
      item,
      [
        "kind",
        "configurationNodeId",
        "configurationOccurrenceId",
        "definitionNodeId",
        "datatypeNodeId",
        "optionsSupertagId",
        "contributionId",
      ],
      "Field Datatype configuration",
    );
    return {
      ...base,
      kind: "datatype",
      datatypeNodeId: item.datatypeNodeId,
      optionsSupertagId:
        item.optionsSupertagId === null ? null : nonempty(item.optionsSupertagId, "Options source Supertag identity"),
    };
  }
  if (item.kind === "cardinality") {
    if (typeof item.cardinalityNodeId !== "string" || item.cardinalityNodeId.length === 0) {
      throw new Error("Field Cardinality endpoint Node identity is invalid");
    }
    exact(
      item,
      [
        "kind",
        "configurationNodeId",
        "configurationOccurrenceId",
        "definitionNodeId",
        "cardinalityNodeId",
        "contributionId",
      ],
      "Field Cardinality configuration",
    );
    return {
      ...base,
      kind: "cardinality",
      cardinalityNodeId: item.cardinalityNodeId,
    };
  }
  if (item.kind === "optionality") {
    if (typeof item.optionalityNodeId !== "string" || item.optionalityNodeId.length === 0) {
      throw new Error("Field Optionality endpoint Node identity is invalid");
    }
    exact(
      item,
      [
        "kind",
        "configurationNodeId",
        "configurationOccurrenceId",
        "definitionNodeId",
        "contributionId",
        "optionalityNodeId",
      ],
      "Field Optionality configuration",
    );
    return {
      ...base,
      kind: "optionality",
      optionalityNodeId: item.optionalityNodeId,
    };
  }
  if (item.kind !== "initialization-expression") {
    throw new Error("Field Definition configuration kind is invalid");
  }
  exact(
    item,
    ["kind", "configurationNodeId", "configurationOccurrenceId", "definitionNodeId", "expression", "contributionId"],
    "Field Initialization Expression configuration",
  );
  return {
    ...base,
    kind: "initialization-expression",
    expression: initializationExpression(item.expression),
  };
}

function initializationExpression(
  value: unknown,
): Extract<FieldDefinitionConfiguration, { kind: "initialization-expression" }>["expression"] {
  const expression = object(value, "Field Initialization Expression");
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
    "Field Initialization Expression",
  );
  if (expression.kind !== "find-field-values") {
    throw new Error("Field Initialization Expression kind is invalid");
  }
  return {
    kind: "find-field-values",
    expressionNodeId: nonempty(expression.expressionNodeId, "initialization expression Node identity"),
    expressionOccurrenceId: nonempty(
      expression.expressionOccurrenceId,
      "initialization expression Occurrence identity",
    ),
    sourceFieldDefinitionId: nonempty(
      expression.sourceFieldDefinitionId,
      "initialization source Field Definition identity",
    ),
    sourceFieldDefinitionOccurrenceId: nonempty(
      expression.sourceFieldDefinitionOccurrenceId,
      "initialization source Field Definition Occurrence identity",
    ),
    contextNodeId: nonempty(expression.contextNodeId, "initialization context Node identity"),
    contextOccurrenceId: nonempty(expression.contextOccurrenceId, "initialization context Occurrence identity"),
  };
}

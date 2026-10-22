import type { FieldDefinitionConfiguration as ProtocolFieldDefinitionConfiguration } from "@lode/protocol/proto";

import type { FieldDefinitionConfiguration, ProjectedFieldInitializationExpression } from "./projection.js";
import { required, selectedCase, unsupportedProtocolCase } from "./protocol-decoding.js";
import type { ProtocolDto } from "./protocol-dto.js";

export function toFieldDefinitionConfiguration(configuration: FieldDefinitionConfiguration): Record<string, unknown> {
  const { kind: _kind, ...fields } = configuration;
  const value =
    configuration.kind === "datatype"
      ? {
          datatypeNodeId: configuration.datatypeNodeId,
          optionsSupertagId: configuration.optionsSupertagId,
        }
      : configuration.kind === "cardinality"
        ? { cardinalityNodeId: configuration.cardinalityNodeId }
        : configuration.kind === "optionality"
          ? { optionalityNodeId: configuration.optionalityNodeId }
          : { expression: withoutExpressionKind(configuration.expression) };
  const protocolCase =
    configuration.kind === "datatype"
      ? "datatype"
      : configuration.kind === "cardinality"
        ? "cardinality"
        : configuration.kind === "optionality"
          ? "optionality"
          : "initializationExpression";
  const {
    datatypeNodeId: _datatypeNodeId,
    cardinalityNodeId: _cardinalityNodeId,
    optionalityNodeId: _optionalityNodeId,
    expression: _expression,
    ...identity
  } = fields as Record<string, unknown>;
  return { ...identity, configuration: { case: protocolCase, value } };
}

export function fromFieldDefinitionConfiguration(value: unknown): FieldDefinitionConfiguration {
  const configuration = value as ProtocolDto<ProtocolFieldDefinitionConfiguration>;
  const selected = selectedCase(configuration.configuration, "Field Definition configuration");
  const identity = {
    configurationNodeId: configuration.configurationNodeId,
    configurationOccurrenceId: configuration.configurationOccurrenceId,
    factActionId: configuration.factActionId,
    definitionNodeId: configuration.definitionNodeId,
  };
  switch (selected.case) {
    case "datatype":
      return {
        ...identity,
        kind: "datatype",
        datatypeNodeId: selected.value.datatypeNodeId,
        optionsSupertagId: selected.value.optionsSupertagId,
      };
    case "cardinality":
      return { ...identity, kind: "cardinality", cardinalityNodeId: selected.value.cardinalityNodeId };
    case "optionality":
      return { ...identity, kind: "optionality", optionalityNodeId: selected.value.optionalityNodeId };
    case "initializationExpression": {
      const expression = required(selected.value.expression, "Initialization expression");
      return {
        ...identity,
        kind: "initialization-expression",
        expression: { kind: "find-field-values", ...expression },
      };
    }
    default:
      return unsupportedProtocolCase(selected, "Field Definition configuration");
  }
}

function withoutExpressionKind(expression: ProjectedFieldInitializationExpression): Record<string, unknown> {
  const { kind: _kind, ...value } = expression;
  return value;
}

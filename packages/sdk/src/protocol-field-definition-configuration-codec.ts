import type { FieldDefinitionConfiguration } from "./projection.js";
import type { FieldInitializationExpression } from "./model.js";
import { required } from "./protocol-shape-codec.js";

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
  const $case =
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
  return { ...identity, configuration: { $case, value } };
}

export function fromFieldDefinitionConfiguration(value: unknown): FieldDefinitionConfiguration {
  const configuration = value as Record<string, unknown>;
  const selected = required(
    configuration.configuration as {
      $case: "datatype" | "cardinality" | "optionality" | "initializationExpression";
      value: Record<string, unknown>;
    } | null,
    "Field Definition configuration",
  );
  const { configuration: _configuration, ...identity } = configuration;
  if (selected.$case === "datatype") {
    return {
      ...identity,
      kind: "datatype",
      datatypeNodeId: selected.value.datatypeNodeId,
      optionsSupertagId: selected.value.optionsSupertagId ?? null,
    } as FieldDefinitionConfiguration;
  }
  if (selected.$case === "cardinality") {
    return {
      ...identity,
      kind: "cardinality",
      cardinalityNodeId: selected.value.cardinalityNodeId,
    } as FieldDefinitionConfiguration;
  }
  if (selected.$case === "optionality") {
    return {
      ...identity,
      kind: "optionality",
      optionalityNodeId: selected.value.optionalityNodeId,
    } as FieldDefinitionConfiguration;
  }
  const expression = required(selected.value.expression as Record<string, unknown> | null, "Initialization expression");
  return {
    ...identity,
    kind: "initialization-expression",
    expression: { kind: "find-field-values", ...expression },
  } as FieldDefinitionConfiguration;
}

function withoutExpressionKind(expression: FieldInitializationExpression): Record<string, unknown> {
  const { kind: _kind, ...value } = expression;
  return value;
}

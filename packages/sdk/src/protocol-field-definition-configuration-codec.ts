import type { FieldDefinitionConfiguration } from "./projection.js";
import { required } from "./protocol-shape-codec.js";

export function toFieldDefinitionConfiguration(configuration: FieldDefinitionConfiguration): Record<string, unknown> {
  const { kind: _kind, ...fields } = configuration;
  const value =
    configuration.kind === "datatype"
      ? { datatype: configuration.datatype }
      : configuration.kind === "cardinality"
        ? { cardinality: configuration.cardinality }
        : { expression: withoutExpressionKind(configuration.expression) };
  const $case =
    configuration.kind === "datatype"
      ? "datatype"
      : configuration.kind === "cardinality"
        ? "cardinality"
        : "initializationExpression";
  const {
    datatype: _datatype,
    cardinality: _cardinality,
    expression: _expression,
    ...identity
  } = fields as Record<string, unknown>;
  return { ...identity, configuration: { $case, value } };
}

export function fromFieldDefinitionConfiguration(value: unknown): FieldDefinitionConfiguration {
  const configuration = value as Record<string, unknown>;
  const selected = required(
    configuration.configuration as {
      $case: "datatype" | "cardinality" | "initializationExpression";
      value: Record<string, unknown>;
    } | null,
    "Field Definition configuration",
  );
  const { configuration: _configuration, ...identity } = configuration;
  if (selected.$case === "datatype") {
    return { ...identity, kind: "datatype", datatype: selected.value.datatype } as FieldDefinitionConfiguration;
  }
  if (selected.$case === "cardinality") {
    return {
      ...identity,
      kind: "cardinality",
      cardinality: selected.value.cardinality,
    } as FieldDefinitionConfiguration;
  }
  const expression = required(selected.value.expression as Record<string, unknown> | null, "Initialization expression");
  return {
    ...identity,
    kind: "initialization-expression",
    expression: { kind: "ancestor-field-values", sourceFieldDefinitionId: expression.sourceFieldDefinitionId },
  } as FieldDefinitionConfiguration;
}

function withoutExpressionKind(expression: { kind: string; sourceFieldDefinitionId: string }): Record<string, unknown> {
  return { sourceFieldDefinitionId: expression.sourceFieldDefinitionId };
}

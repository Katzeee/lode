import { assertKeys, assertObject, assertOneOf, requireString } from "../../decoding/index.js";
import type { FieldDefinitionConfigurationValue } from "./field-definition-config-types.js";

export function parseFieldDefinitionConfiguration(value: unknown): FieldDefinitionConfigurationValue {
  assertObject(value, "Field Definition configuration");
  const configuration = value;
  assertOneOf(
    configuration.kind,
    ["datatype", "cardinality", "optionality", "initialization-expression"],
    "Field Definition configuration kind",
  );
  if (configuration.kind === "datatype") {
    assertKeys(configuration, ["kind", "datatypeNodeId", "optionsSupertagId"], "Field Datatype configuration");
    requireString(configuration.datatypeNodeId, "Field Datatype endpoint Node identity");
    if (configuration.optionsSupertagId !== undefined) {
      requireString(configuration.optionsSupertagId, "Options source Supertag identity");
    }
    return configuration as FieldDefinitionConfigurationValue;
  }
  if (configuration.kind === "cardinality") {
    assertKeys(configuration, ["kind", "cardinalityNodeId"], "Field Cardinality configuration");
    requireString(configuration.cardinalityNodeId, "Field Cardinality endpoint Node identity");
    return configuration as FieldDefinitionConfigurationValue;
  }
  if (configuration.kind === "optionality") {
    assertKeys(configuration, ["kind", "optionalityNodeId"], "Field Optionality configuration");
    requireString(configuration.optionalityNodeId, "Field Optionality endpoint Node identity");
    return configuration as FieldDefinitionConfigurationValue;
  }
  assertKeys(configuration, ["kind", "expression"], "Field Initialization Expression configuration");
  assertObject(configuration.expression, "Field Initialization Expression");
  assertKeys(configuration.expression, ["kind", "sourceFieldDefinitionId"], "Field Initialization Expression");
  assertOneOf(configuration.expression.kind, ["find-field-values"], "Field Initialization Expression kind");
  requireString(
    configuration.expression.sourceFieldDefinitionId,
    "Field Initialization Expression source Field Definition",
  );
  return configuration as FieldDefinitionConfigurationValue;
}

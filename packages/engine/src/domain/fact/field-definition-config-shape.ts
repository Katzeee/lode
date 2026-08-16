import {
  assertKeys,
  assertObject,
  assertOneOf,
  assertStringArray,
  requireString,
} from "../../shape-validation/index.js";

export function assertFieldDefinitionConfigMutationShape(value: Record<string, unknown>): void {
  requireString(value.fieldDefinitionId, "Field Definition identity");
  requireString(value.configurationNodeId, "Field configuration Node identity");
  requireString(value.configurationOccurrenceId, "Field configuration Occurrence identity");
  if (value.observedValueFactIds !== undefined) {
    assertStringArray(value.observedValueFactIds, "observed Field configuration Facts");
  }
  if (value.kind === "field-datatype-configure") {
    assertOneOf(value.datatype, ["plain", "options"], "Field Datatype");
    if (value.previousDatatype !== undefined && value.previousDatatype !== null) {
      assertOneOf(value.previousDatatype, ["plain", "options"], "previous Field Datatype");
    }
    return;
  }
  if (value.kind === "field-cardinality-configure") {
    assertOneOf(value.cardinality, ["single", "list"], "Field Cardinality");
    if (value.previousCardinality !== undefined && value.previousCardinality !== null) {
      assertOneOf(value.previousCardinality, ["single", "list"], "previous Field Cardinality");
    }
    return;
  }
  assertFieldInitializationExpression(value.expression, "Field Initialization Expression");
  if (value.previousExpression !== undefined && value.previousExpression !== null) {
    assertFieldInitializationExpression(value.previousExpression, "previous Field Initialization Expression");
  }
}

function assertFieldInitializationExpression(value: unknown, label: string): void {
  assertObject(value, label);
  assertKeys(value, ["kind", "sourceFieldDefinitionId"], label);
  assertOneOf(value.kind, ["ancestor-field-values"], `${label} kind`);
  requireString(value.sourceFieldDefinitionId, `${label} source Field Definition`);
}

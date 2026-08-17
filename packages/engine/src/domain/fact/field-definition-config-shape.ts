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
    requireString(value.datatypeNodeId, "Field Datatype endpoint Node identity");
    if (value.previousDatatypeNodeId !== undefined && value.previousDatatypeNodeId !== null) {
      requireString(value.previousDatatypeNodeId, "previous Field Datatype endpoint Node identity");
    }
    return;
  }
  if (value.kind === "field-cardinality-configure") {
    requireString(value.cardinalityNodeId, "Field Cardinality endpoint Node identity");
    if (value.previousCardinalityNodeId !== undefined && value.previousCardinalityNodeId !== null) {
      requireString(value.previousCardinalityNodeId, "previous Field Cardinality endpoint Node identity");
    }
    return;
  }
  if (value.kind === "field-optionality-configure") {
    requireString(value.optionalityNodeId, "Field Optionality endpoint Node identity");
    if (value.previousOptionalityNodeId !== undefined && value.previousOptionalityNodeId !== null) {
      requireString(value.previousOptionalityNodeId, "previous Field Optionality endpoint Node identity");
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
  assertKeys(
    value,
    [
      "kind",
      "expressionNodeId",
      "expressionOccurrenceId",
      "sourceFieldDefinitionId",
      "sourceFieldDefinitionOccurrenceId",
      "contextNodeId",
      "contextOccurrenceId",
    ],
    label,
  );
  assertOneOf(value.kind, ["find-field-values"], `${label} kind`);
  requireString(value.expressionNodeId, `${label} Node identity`);
  requireString(value.expressionOccurrenceId, `${label} Occurrence identity`);
  requireString(value.sourceFieldDefinitionId, `${label} source Field Definition`);
  requireString(value.sourceFieldDefinitionOccurrenceId, `${label} source Field Definition Occurrence`);
  requireString(value.contextNodeId, `${label} context Node identity`);
  requireString(value.contextOccurrenceId, `${label} context Occurrence identity`);
}

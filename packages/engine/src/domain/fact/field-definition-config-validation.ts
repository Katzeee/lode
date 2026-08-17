import type { FieldDefinitionConfigMutation } from "./field-definition-config-types.js";
import { FIELD_CARDINALITY_NODE_IDS, FIELD_DATATYPE_NODE_IDS, FIELD_OPTIONALITY_NODE_IDS } from "./identity.js";
import { requireIdentity } from "./mutation-static-validation-primitives.js";

export function validateFieldDefinitionConfigMutation(
  mutation: FieldDefinitionConfigMutation,
  factIdentity: string,
): void {
  requireIdentity(mutation.fieldDefinitionId, "Field Definition", factIdentity);
  requireIdentity(mutation.configurationNodeId, "Field configuration Node", factIdentity);
  requireIdentity(mutation.configurationOccurrenceId, "Field configuration Occurrence", factIdentity);
  if (
    mutation.observedValueFactIds === undefined ||
    new Set(mutation.observedValueFactIds).size !== mutation.observedValueFactIds.length
  ) {
    throw new Error(`Field Definition configuration lacks unique semantic evidence: ${factIdentity}`);
  }
  mutation.observedValueFactIds.forEach((id) => requireIdentity(id, "observed configuration Fact", factIdentity));
  const previous =
    mutation.kind === "field-datatype-configure"
      ? mutation.previousDatatypeNodeId
      : mutation.kind === "field-cardinality-configure"
        ? mutation.previousCardinalityNodeId
        : mutation.kind === "field-optionality-configure"
          ? mutation.previousOptionalityNodeId
          : mutation.previousExpression;
  if (previous === undefined) {
    throw new Error(`Field Definition configuration lacks previous value evidence: ${factIdentity}`);
  }
  if (mutation.kind !== "field-initialization-expression-configure") {
    const endpointNodeId =
      mutation.kind === "field-datatype-configure"
        ? mutation.datatypeNodeId
        : mutation.kind === "field-cardinality-configure"
          ? mutation.cardinalityNodeId
          : mutation.optionalityNodeId;
    requireIdentity(endpointNodeId, "Field configuration endpoint Node", factIdentity);
    const supportedEndpointIds: readonly string[] =
      mutation.kind === "field-datatype-configure"
        ? Object.values(FIELD_DATATYPE_NODE_IDS)
        : mutation.kind === "field-cardinality-configure"
          ? Object.values(FIELD_CARDINALITY_NODE_IDS)
          : Object.values(FIELD_OPTIONALITY_NODE_IDS);
    if (!supportedEndpointIds.includes(endpointNodeId)) {
      throw new Error(`Field configuration endpoint is unsupported: ${factIdentity}`);
    }
    return;
  }
  requireIdentity(mutation.expression.sourceFieldDefinitionId, "initialization source Field Definition", factIdentity);
  requireIdentity(mutation.expression.expressionNodeId, "initialization expression Node", factIdentity);
  requireIdentity(mutation.expression.expressionOccurrenceId, "initialization expression Occurrence", factIdentity);
  requireIdentity(
    mutation.expression.sourceFieldDefinitionOccurrenceId,
    "initialization source Field Definition Occurrence",
    factIdentity,
  );
  requireIdentity(mutation.expression.contextNodeId, "initialization context Node", factIdentity);
  requireIdentity(mutation.expression.contextOccurrenceId, "initialization context Occurrence", factIdentity);
  if (mutation.expression.sourceFieldDefinitionId !== mutation.fieldDefinitionId) {
    throw new Error(`Field initialization must read the configured Field Definition: ${factIdentity}`);
  }
  const expressionNodeIds = [
    mutation.expression.expressionNodeId,
    mutation.expression.sourceFieldDefinitionId,
    mutation.expression.contextNodeId,
  ];
  const expressionOccurrenceIds = [
    mutation.expression.expressionOccurrenceId,
    mutation.expression.sourceFieldDefinitionOccurrenceId,
    mutation.expression.contextOccurrenceId,
  ];
  if (
    new Set(expressionNodeIds).size !== expressionNodeIds.length ||
    new Set(expressionOccurrenceIds).size !== expressionOccurrenceIds.length
  ) {
    throw new Error(`Field initialization expression identities must be distinct: ${factIdentity}`);
  }
  if (mutation.previousExpression !== null && mutation.previousExpression !== undefined) {
    for (const [id, label] of [
      [mutation.previousExpression.expressionNodeId, "previous initialization expression Node"],
      [mutation.previousExpression.expressionOccurrenceId, "previous initialization expression Occurrence"],
      [mutation.previousExpression.sourceFieldDefinitionId, "previous initialization source Field Definition"],
      [
        mutation.previousExpression.sourceFieldDefinitionOccurrenceId,
        "previous initialization source Field Definition Occurrence",
      ],
      [mutation.previousExpression.contextNodeId, "previous initialization context Node"],
      [mutation.previousExpression.contextOccurrenceId, "previous initialization context Occurrence"],
    ] as const) {
      requireIdentity(id, label, factIdentity);
    }
  }
}

import type { FieldDefinitionConfigMutation } from "./field-definition-config-types.js";
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
      ? mutation.previousDatatype
      : mutation.kind === "field-cardinality-configure"
        ? mutation.previousCardinality
        : mutation.previousExpression;
  if (previous === undefined) {
    throw new Error(`Field Definition configuration lacks previous value evidence: ${factIdentity}`);
  }
  if (mutation.kind !== "field-initialization-expression-configure") {
    return;
  }
  requireIdentity(mutation.expression.sourceFieldDefinitionId, "initialization source Field Definition", factIdentity);
  if (mutation.expression.sourceFieldDefinitionId !== mutation.fieldDefinitionId) {
    throw new Error(`Field initialization must read the configured Field Definition: ${factIdentity}`);
  }
  if (mutation.previousExpression !== null && mutation.previousExpression !== undefined) {
    requireIdentity(
      mutation.previousExpression.sourceFieldDefinitionId,
      "previous initialization source Field Definition",
      factIdentity,
    );
  }
}

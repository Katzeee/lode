import { FIELD_CARDINALITY_NODE_IDS, FIELD_DATATYPE_NODE_IDS } from "../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../domain/reconcile/index.js";

export function validatePlainOrOptionsValue(
  fieldDefinitionId: string,
  ownerNodeId: string,
  available: ScopedProjection,
): void {
  const configurations = available.fieldDefinitionConfigurations[fieldDefinitionId] ?? [];
  const datatypes = configurations.filter((configuration) => configuration.kind === "datatype");
  if (datatypes.length > 1) {
    throw new Error("Field Definition must have an unconflicted Datatype configuration");
  }
  const datatypeNodeId = datatypes[0]?.datatypeNodeId ?? FIELD_DATATYPE_NODE_IDS.plain;
  if (datatypeNodeId !== FIELD_DATATYPE_NODE_IDS.plain && datatypeNodeId !== FIELD_DATATYPE_NODE_IDS.options) {
    throw new Error("Typed Field Values require a typed value edit");
  }
  const cardinalities = configurations.filter((configuration) => configuration.kind === "cardinality");
  if (cardinalities.length > 1) {
    throw new Error("Field Definition must have an unconflicted Cardinality configuration");
  }
  const field = available.materializedFields[ownerNodeId]?.find(
    (candidate) => candidate.fieldDefinitionId === fieldDefinitionId,
  );
  if (
    cardinalities[0]?.cardinalityNodeId === FIELD_CARDINALITY_NODE_IDS.single &&
    (field?.valueOccurrenceIds.length ?? 0) > 0
  ) {
    throw new Error("Single-value Field already has an authored value");
  }
}

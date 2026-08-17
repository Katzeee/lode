import {
  FIELD_CARDINALITY_NODE_IDS,
  FIELD_DATATYPE_NODE_IDS,
  type FactTransaction,
  type Mutation,
} from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";

export function validateFieldValueOccurrenceMutation(
  transaction: FactTransaction,
  mutation: Mutation,
  previous: Projection,
  projection: Projection,
): void {
  if (
    mutation.kind !== "occurrence-create" &&
    mutation.kind !== "occurrence-move" &&
    mutation.kind !== "occurrence-delete" &&
    mutation.kind !== "occurrence-restore"
  ) {
    return;
  }
  const previousField = materializedFieldContaining(previous, mutation.occurrenceId);
  const field = materializedFieldContaining(projection, mutation.occurrenceId);
  if (mutation.kind === "occurrence-move") {
    if (previousField === undefined && field === undefined) {
      return;
    }
    if (
      previousField !== undefined &&
      mutation.parentNodeId === previous.workspaceSystemNodes.trash &&
      transaction.facts.some(
        (fact) =>
          fact.body.kind === "contribution" &&
          fact.body.mutation.kind === "field-value-delete" &&
          fact.body.mutation.valueOccurrenceId === mutation.occurrenceId,
      )
    ) {
      return;
    }
    if (
      previousField === undefined &&
      field !== undefined &&
      mutation.previousParentNodeId === previous.workspaceSystemNodes.trash &&
      projection.nodeOwners[projection.occurrences[mutation.occurrenceId]?.nodeId ?? ""] === field.fieldNodeId
    ) {
      return;
    }
    if (
      previousField === undefined ||
      field === undefined ||
      previousField.fieldNodeId !== field.fieldNodeId ||
      mutation.parentNodeId !== previousField.fieldNodeId
    ) {
      throw new Error("Field Values can only be reordered within their Field");
    }
    return;
  }
  if (mutation.kind !== "occurrence-create" || field === undefined) {
    return;
  }
  const configurations = projection.fieldDefinitionConfigurations[field.fieldDefinitionId] ?? [];
  const cardinalities = configurations.filter((configuration) => configuration.kind === "cardinality");
  if (cardinalities.length > 1) {
    throw new Error("Field Value admission requires an unconflicted Cardinality configuration");
  }
  const previousCount = previous.materializedFields[field.ownerNodeId]?.find(
    (candidate) => candidate.fieldDefinitionId === field.fieldDefinitionId,
  )?.valueOccurrenceIds.length;
  if (
    cardinalities[0]?.cardinalityNodeId === FIELD_CARDINALITY_NODE_IDS.single &&
    field.valueOccurrenceIds.length > Math.max(previousCount ?? 0, 1)
  ) {
    throw new Error("Single-value Field cannot admit another value");
  }
  const datatypes = configurations.filter((configuration) => configuration.kind === "datatype");
  if (datatypes.length > 1) {
    throw new Error("Field Value admission requires an unconflicted Datatype configuration");
  }
  const datatypeNodeId = datatypes[0]?.datatypeNodeId ?? FIELD_DATATYPE_NODE_IDS.plain;
  if (
    isTypedDatatype(datatypeNodeId) &&
    !transaction.facts.some(
      (fact) =>
        fact.body.kind === "contribution" &&
        fact.body.mutation.kind === "field-materialize" &&
        fact.body.mutation.ownerNodeId === field.ownerNodeId &&
        fact.body.mutation.fieldDefinitionId === field.fieldDefinitionId &&
        fact.body.mutation.fieldNodeId === field.fieldNodeId,
    )
  ) {
    throw new Error("Typed Field Values require a typed value edit");
  }
}

function materializedFieldContaining(
  projection: Projection,
  occurrenceId: string,
): Projection["materializedFields"][string][number] | undefined {
  const viewConfigurationFieldNodeIds = new Set(
    Object.values(projection.sharedDefaultViewDefinitions)
      .flat()
      .flatMap((definition) =>
        definition.sortByNameAscending === null
          ? []
          : [definition.sortByNameAscending.sortOrderFieldNodeId, definition.sortByNameAscending.sortFieldNodeId],
      ),
  );
  return Object.values(projection.materializedFields)
    .flat()
    .find(
      (field) =>
        !viewConfigurationFieldNodeIds.has(field.fieldNodeId) && field.valueOccurrenceIds.includes(occurrenceId),
    );
}

function isTypedDatatype(datatypeNodeId: string): boolean {
  return (
    datatypeNodeId === FIELD_DATATYPE_NODE_IDS.optionsFromSupertag ||
    datatypeNodeId === FIELD_DATATYPE_NODE_IDS.number ||
    datatypeNodeId === FIELD_DATATYPE_NODE_IDS.checkbox ||
    datatypeNodeId === FIELD_DATATYPE_NODE_IDS.date
  );
}

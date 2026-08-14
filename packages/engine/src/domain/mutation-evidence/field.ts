import {
  FIELD_DEFINITION_NODE_TYPE,
  SCHEMA_NODE_TYPE,
  fieldContentDeletionOccurrenceId,
  type FieldContentDeletionMutation,
  type Mutation,
} from "../fact/index.js";
import {
  definitionNodeState,
  occurrenceAnchor,
  type ScopedProjection,
} from "../reconcile/index.js";

export function completeFieldContentDeletionEvidence(
  mutation: FieldContentDeletionMutation,
  previous: ScopedProjection,
  available: ScopedProjection,
): FieldContentDeletionMutation {
  const field = available.materializedFields[mutation.ownerNodeId]?.find(
    (candidate) => candidate.fieldDefinitionId === mutation.fieldDefinitionId,
  );
  const occurrenceId = fieldContentDeletionOccurrenceId(mutation);
  if (
    !field ||
    (mutation.kind === "field-value-delete" && !field.valueOccurrenceIds.includes(occurrenceId)) ||
    (mutation.kind === "materialized-field-delete" &&
      (field.fieldNodeId !== mutation.fieldNodeId || field.fieldOccurrenceId !== occurrenceId))
  ) {
    throw new Error("Field content deletion target does not match the observed Materialized Field");
  }
  const evidence = previous.occurrences[occurrenceId] ? previous : available;
  const occurrence = evidence.occurrences[occurrenceId];
  if (!occurrence) {
    throw new Error("Field content deletion Occurrence is absent from the observed projection");
  }
  return {
    ...mutation,
    previousParentNodeId: occurrence.parentNodeId,
    previousAnchor: occurrenceAnchor(evidence, occurrenceId),
  };
}

export function completeFieldInitializationEvidence(
  mutation: Extract<Mutation, { kind: "field-initialize" }>,
  available: ScopedProjection,
): Extract<Mutation, { kind: "field-initialize" }> {
  if (definitionNodeState(available, mutation.schemaId, SCHEMA_NODE_TYPE) === "absent") {
    throw new Error("Field initialization Schema type is absent");
  }
  if (
    definitionNodeState(available, mutation.fieldDefinitionId, FIELD_DEFINITION_NODE_TYPE) ===
    "absent"
  ) {
    throw new Error("Field initialization Field Definition type is absent");
  }
  for (const nodeId of [mutation.ownerNodeId, mutation.schemaId, mutation.fieldDefinitionId]) {
    if (!available.nodes[nodeId]) {
      throw new Error(`Field initialization dependency is absent: ${nodeId}`);
    }
  }
  const field = available.effectiveFields[mutation.ownerNodeId]?.find(
    (candidate) => candidate.fieldDefinitionId === mutation.fieldDefinitionId,
  );
  if (!field) {
    throw new Error("Field initialization has no effective Schema source");
  }
  if (field.materializedFieldNodeId !== null) {
    throw new Error("Field is already materialized");
  }
  return {
    ...mutation,
    observedInitializationFactIds: field.initializationCandidates.map(
      (candidate) => candidate.initializationId,
    ),
  };
}

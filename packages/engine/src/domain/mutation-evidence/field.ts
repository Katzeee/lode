import {
  FIELD_DEFINITION_NODE_TYPE,
  SCHEMA_NODE_TYPE,
  canonicalJson,
  fieldContentDeletionOccurrenceId,
  type FieldContentDeletionMutation,
  type FieldMutation,
  type Mutation,
} from "../fact/index.js";
import {
  assertMaterializedField,
  definitionNodeState,
  occurrenceAnchor,
  type ScopedProjection,
} from "../reconcile/index.js";
import type { MutationEvidenceContext, MutationEvidenceFamily } from "./policy.js";

const FIELD_MUTATION_KINDS = [
  "field-materialize",
  "field-value-delete",
  "materialized-field-delete",
  "field-initialize",
] as const satisfies readonly FieldMutation["kind"][];

export const fieldMutationEvidence = {
  key: "field",
  mutationKinds: FIELD_MUTATION_KINDS,
  complete: completeFieldMutationEvidence,
  validate(mutation, context) {
    const { previous, available } = context.projections();
    if (mutation.kind === "field-value-delete" || mutation.kind === "materialized-field-delete") {
      const expected = completeFieldContentDeletionEvidence(mutation, previous, available);
      if (
        expected.previousParentNodeId !== mutation.previousParentNodeId ||
        canonicalJson(expected.previousAnchor) !== canonicalJson(mutation.previousAnchor)
      ) {
        throw new Error("Field content deletion evidence does not match the observed Projection");
      }
    }
    if (mutation.kind === "field-initialize") {
      const expected = completeFieldInitializationEvidence(mutation, available);
      if (
        canonicalJson([...(expected.observedInitializationFactIds ?? [])].sort()) !==
        canonicalJson([...(mutation.observedInitializationFactIds ?? [])].sort())
      ) {
        throw new Error("Field initialization evidence does not match current candidates");
      }
    }
  },
} satisfies MutationEvidenceFamily<(typeof FIELD_MUTATION_KINDS)[number]>;

function completeFieldMutationEvidence(mutation: FieldMutation, context: MutationEvidenceContext): FieldMutation {
  const { previous, available } = context.projections();
  switch (mutation.kind) {
    case "field-materialize":
      assertMaterializedField(mutation, available);
      return mutation;
    case "field-value-delete":
    case "materialized-field-delete":
      return completeFieldContentDeletionEvidence(mutation, previous, available);
    case "field-initialize":
      return completeFieldInitializationEvidence(mutation, available);
  }
}

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
  if (definitionNodeState(available, mutation.fieldDefinitionId, FIELD_DEFINITION_NODE_TYPE) === "absent") {
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
    observedInitializationFactIds: field.initializationCandidates.map((candidate) => candidate.initializationId),
  };
}

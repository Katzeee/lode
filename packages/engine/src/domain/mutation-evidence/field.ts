import {
  canonicalJson,
  fieldContentDeletionOccurrenceId,
  type FieldContentDeletionMutation,
  type FieldMutation,
} from "../fact/index.js";
import { assertMaterializedField, occurrenceAnchor, type ScopedProjection } from "../reconcile/index.js";
import type { MutationEvidenceContext, MutationEvidenceFamily } from "./policy.js";

const FIELD_MUTATION_KINDS = [
  "field-materialize",
  "field-value-delete",
  "materialized-field-delete",
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

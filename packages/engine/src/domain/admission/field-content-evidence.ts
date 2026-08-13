import { canonicalJson, type Mutation, type SequenceAnchor } from "../fact/index.js";
import type { Projection } from "../reconcile/index.js";

type FieldContentDeletion = Extract<
  Mutation,
  { kind: "field-value-delete" | "materialized-field-delete" }
>;

export function validateFieldContentDeletionEvidence(
  mutation: FieldContentDeletion,
  previous: Projection,
  available: Projection,
): void {
  const field = available.materializedFields[mutation.ownerNodeId]?.find(
    (candidate) => candidate.fieldDefinitionId === mutation.fieldDefinitionId,
  );
  const occurrenceId =
    mutation.kind === "field-value-delete"
      ? mutation.valueOccurrenceId
      : mutation.fieldOccurrenceId;
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
  if (
    !occurrence ||
    occurrence.parentNodeId !== mutation.previousParentNodeId ||
    canonicalJson(anchorFor(evidence, occurrenceId)) !== canonicalJson(mutation.previousAnchor)
  ) {
    throw new Error("Field content deletion evidence does not match the observed Projection");
  }
}

function anchorFor(projection: Projection, occurrenceId: string): SequenceAnchor {
  const occurrence = projection.occurrences[occurrenceId];
  const siblings = occurrence ? (projection.children[occurrence.parentNodeId] ?? []) : [];
  const index = siblings.indexOf(occurrenceId);
  return {
    after: index > 0 ? (siblings[index - 1] ?? null) : null,
    before: index >= 0 ? (siblings[index + 1] ?? null) : null,
    affinity: "after",
    fallback: index <= 0 ? "start" : "end",
  };
}

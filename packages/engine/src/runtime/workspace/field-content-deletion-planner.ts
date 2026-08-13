import type { Mutation, SequenceAnchor } from "../../domain/fact/index.js";
import type { Projection } from "../../domain/reconcile/index.js";

type FieldContentDeletion = Extract<
  Mutation,
  { kind: "field-value-delete" | "materialized-field-delete" }
>;

export function prepareFieldContentDeletion(
  mutation: FieldContentDeletion,
  previous: Projection,
  available: Projection,
): Mutation {
  const field = available.materializedFields[mutation.ownerNodeId]?.find(
    (candidate) => candidate.fieldDefinitionId === mutation.fieldDefinitionId,
  );
  if (!field) {
    throw new Error("Materialized Field does not exist");
  }
  const occurrenceId =
    mutation.kind === "field-value-delete"
      ? mutation.valueOccurrenceId
      : mutation.fieldOccurrenceId;
  if (
    mutation.kind === "field-value-delete" &&
    !field.valueOccurrenceIds.includes(mutation.valueOccurrenceId)
  ) {
    throw new Error("Field Value does not belong to the Materialized Field");
  }
  if (
    mutation.kind === "materialized-field-delete" &&
    (field.fieldNodeId !== mutation.fieldNodeId ||
      field.fieldOccurrenceId !== mutation.fieldOccurrenceId)
  ) {
    throw new Error("Materialized Field identity does not match the current Field");
  }
  const occurrence = available.occurrences[occurrenceId];
  if (!occurrence) {
    throw new Error("Field content Occurrence does not exist");
  }
  const evidence = previous.occurrences[occurrenceId] ? previous : available;
  return {
    ...mutation,
    previousParentNodeId: evidence.occurrences[occurrenceId]?.parentNodeId,
    previousAnchor: anchorFor(evidence, occurrenceId),
  };
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

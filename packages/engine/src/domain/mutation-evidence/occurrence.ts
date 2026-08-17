import { workspaceTrashOccurrenceId, type Mutation, type OccurrenceMutation } from "../fact/index.js";
import { isPresentNodeOutsideTrash, occurrenceAnchor, type ScopedProjection } from "../reconcile/index.js";
import { assertObservedDeletion } from "./lifecycle.js";
import type { MutationEvidenceContext, MutationEvidenceFamily } from "./policy.js";
import { assertEvidenceEqual } from "./evidence-validation.js";

type MutableOccurrenceMutation = Extract<Mutation, { kind: "occurrence-move" | "occurrence-delete" }>;

const OCCURRENCE_MUTATION_KINDS = [
  "occurrence-create",
  "occurrence-delete",
  "occurrence-restore",
  "occurrence-move",
] as const satisfies readonly OccurrenceMutation["kind"][];

export const occurrenceMutationEvidence = {
  key: "occurrence",
  mutationKinds: OCCURRENCE_MUTATION_KINDS,
  complete: completeOccurrenceMutationEvidence,
  validate(mutation, context) {
    if (mutation.kind !== "occurrence-move" && mutation.kind !== "occurrence-delete") {
      return;
    }
    const { previous, available } = context.projections();
    const expected = completeMutableOccurrenceEvidence(mutation, previous, available);
    assertEvidenceEqual(
      expected.previousParentNodeId,
      mutation.previousParentNodeId,
      "Occurrence previous parent evidence",
    );
    assertEvidenceEqual(
      expected.previousAnchor,
      mutation.previousAnchor,
      `Occurrence ${mutation.occurrenceId} previous anchor evidence`,
    );
  },
} satisfies MutationEvidenceFamily<(typeof OCCURRENCE_MUTATION_KINDS)[number]>;

function completeOccurrenceMutationEvidence(
  mutation: OccurrenceMutation,
  context: MutationEvidenceContext,
): OccurrenceMutation {
  switch (mutation.kind) {
    case "occurrence-create":
      return completeOccurrenceCreate(mutation, context.projections().available);
    case "occurrence-delete":
    case "occurrence-move": {
      const { previous, available } = context.projections();
      return completeMutableOccurrenceEvidence(mutation, previous, available);
    }
    case "occurrence-restore":
      assertObservedDeletion(context.snapshot, mutation.deletionFactId, "occurrence-delete", mutation.occurrenceId);
      assertOccurrenceParent(context.projections().available, mutation.parentNodeId);
      return mutation;
  }
}

export function completeOccurrenceCreate(
  mutation: Extract<Mutation, { kind: "occurrence-create" }>,
  available: ScopedProjection,
): Extract<Mutation, { kind: "occurrence-create" }> {
  if (!isPresentNodeOutsideTrash(available.identity.workspaceNodeId, available, mutation.nodeId)) {
    throw new Error("Occurrence Node is absent from the observed projection");
  }
  assertOccurrenceParent(available, mutation.parentNodeId);
  const existing = available.occurrences[mutation.occurrenceId];
  if (existing && (existing.nodeId !== mutation.nodeId || existing.parentNodeId !== mutation.parentNodeId)) {
    throw new Error("Occurrence identity already names another placement");
  }
  assertUniquePlacement(available, mutation.nodeId, mutation.parentNodeId, mutation.occurrenceId);
  return mutation;
}

function completeMutableOccurrenceEvidence(
  mutation: MutableOccurrenceMutation,
  previous: ScopedProjection,
  available: ScopedProjection,
): MutableOccurrenceMutation {
  if (mutation.occurrenceId === workspaceTrashOccurrenceId(available.identity.workspaceNodeId)) {
    throw new Error("Workspace Trash role cannot be moved or deleted");
  }
  const occurrence = available.occurrences[mutation.occurrenceId];
  if (!occurrence) {
    throw new Error("Occurrence target is absent from the observed projection");
  }
  if (mutation.kind === "occurrence-move") {
    assertOccurrenceParent(available, mutation.parentNodeId);
    assertUniquePlacement(available, occurrence.nodeId, mutation.parentNodeId, mutation.occurrenceId);
  }
  const evidence = previous.occurrences[mutation.occurrenceId] ? previous : available;
  return {
    ...mutation,
    previousParentNodeId: evidence.occurrences[mutation.occurrenceId]?.parentNodeId,
    previousAnchor: occurrenceAnchor(evidence, mutation.occurrenceId),
  };
}

export function assertOccurrenceParent(projection: ScopedProjection, parentNodeId: string): void {
  if (!isPresentNodeOutsideTrash(projection.identity.workspaceNodeId, projection, parentNodeId)) {
    throw new Error("Parent Node is absent from the observed projection");
  }
}

function assertUniquePlacement(
  projection: ScopedProjection,
  nodeId: string,
  parentNodeId: string,
  excludedOccurrenceId?: string,
): void {
  if (
    Object.values(projection.occurrences).some(
      (occurrence) =>
        occurrence.occurrenceId !== excludedOccurrenceId &&
        occurrence.nodeId === nodeId &&
        occurrence.parentNodeId === parentNodeId,
    )
  ) {
    throw new Error("A Node cannot appear twice in one parent Node childOccurrences list");
  }
}

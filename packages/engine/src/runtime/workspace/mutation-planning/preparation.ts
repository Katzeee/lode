import {
  isFieldContentDeletionMutation,
  isSchemaMutation,
  type FactSnapshot,
  type Mutation,
} from "../../../domain/fact/index.js";
import { assertMaterializedField, type ScopedProjection } from "../../../domain/reconcile/index.js";
import {
  assertOccurrenceParent,
  assertNodeDeletionTarget,
  assertObservedDeletion,
  completeFieldContentDeletionEvidence,
  completeFieldInitializationEvidence,
  completeMutableOccurrenceEvidence,
  completeNodeOwnerEvidence,
  completeOccurrenceCreate,
  completeSchemaMutationEvidence,
  completeTextMarkEvidence,
  completeTextSpliceEvidence,
  completeTemplateDetachmentEvidence,
  completeValueMutationEvidence,
} from "../../../domain/mutation-evidence/index.js";
import { prepareNodeTypeMutation } from "./node-type-mutation-planner.js";

export function prepareMutation(
  mutation: Mutation,
  previous: ScopedProjection,
  available: ScopedProjection,
  snapshot: FactSnapshot,
): Mutation {
  if (isSchemaMutation(mutation)) {
    return completeSchemaMutationEvidence(mutation, previous, available);
  }
  if (isFieldContentDeletionMutation(mutation)) {
    return completeFieldContentDeletionEvidence(mutation, previous, available);
  }
  const preparedOccurrence = completeMutableOccurrenceEvidence(mutation, previous, available);
  if (preparedOccurrence) {
    return preparedOccurrence;
  }
  switch (mutation.kind) {
    case "text-splice":
      return completeTextSpliceEvidence(mutation, available);
    case "text-mark":
      return completeTextMarkEvidence(mutation, previous, available);
    case "value-set":
    case "value-unset":
      return completeValueMutationEvidence(mutation, previous, available);
    case "node-owner-set":
      return completeNodeOwnerEvidence(mutation, previous, available);
    case "node-type-declare":
      return prepareNodeTypeMutation(mutation, available);
    case "node-delete":
      assertNodeDeletionTarget(mutation, available);
      return mutation;
    case "node-restore":
      assertObservedDeletion(snapshot, mutation.deletionFactId, "node-delete", mutation.nodeId);
      return mutation;
    case "occurrence-create":
      return completeOccurrenceCreate(mutation, available);
    case "occurrence-restore":
      assertObservedDeletion(
        snapshot,
        mutation.deletionFactId,
        "occurrence-delete",
        mutation.occurrenceId,
      );
      assertOccurrenceParent(available, mutation.parentNodeId);
      return mutation;
    case "field-materialize":
      assertMaterializedField(mutation, available);
      return mutation;
    case "field-initialize":
      return completeFieldInitializationEvidence(mutation, available);
    case "template-node-detach":
      return completeTemplateDetachmentEvidence(mutation, available);
    case "occurrence-move":
    case "occurrence-delete":
    case "node-create":
      return mutation;
  }
}

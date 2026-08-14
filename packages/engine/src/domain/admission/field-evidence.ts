import { canonicalJson, type FieldContentDeletionMutation, type Mutation } from "../fact/index.js";
import {
  completeFieldContentDeletionEvidence,
  completeFieldInitializationEvidence,
} from "../mutation-evidence/index.js";
import type { Projection } from "../reconcile/index.js";

export function validateFieldContentDeletionEvidence(
  mutation: FieldContentDeletionMutation,
  previous: Projection,
  available: Projection,
): void {
  const expected = completeFieldContentDeletionEvidence(mutation, previous, available);
  if (
    expected.previousParentNodeId !== mutation.previousParentNodeId ||
    canonicalJson(expected.previousAnchor) !== canonicalJson(mutation.previousAnchor)
  ) {
    throw new Error("Field content deletion evidence does not match the observed Projection");
  }
}

export function validateFieldInitializationEvidence(
  mutation: Extract<Mutation, { kind: "field-initialize" }>,
  available: Projection,
): void {
  const expected = completeFieldInitializationEvidence(mutation, available);
  if (
    canonicalJson([...(expected.observedInitializationFactIds ?? [])].sort()) !==
    canonicalJson([...(mutation.observedInitializationFactIds ?? [])].sort())
  ) {
    throw new Error("Field initialization evidence does not match current candidates");
  }
}

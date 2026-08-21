import { assertKeys, assertNullableString, assertObject, assertOneOf, requireString } from "../../decoding/index.js";
import { requireIdentity, validateAnchor } from "./mutation-static-validation-primitives.js";
import type { InlineReferenceMutation } from "./inline-reference-types.js";

export function assertInlineReferenceMutationShape(value: Record<string, unknown>): void {
  requireString(value.inlineReferenceId, "Inline Reference identity");
  if (value.kind === "inline-reference-create") {
    requireString(value.hostNodeId, "Inline Reference host Node");
    requireString(value.targetNodeId, "Inline Reference target Node");
    assertAnchorShape(value.anchor);
  } else if (value.kind === "inline-reference-delete") {
    if (value.previousHostNodeId !== undefined) {
      requireString(value.previousHostNodeId, "previous Inline Reference host Node");
    }
    if (value.previousTargetNodeId !== undefined) {
      requireString(value.previousTargetNodeId, "previous Inline Reference target Node");
    }
    if (value.previousAnchor !== undefined) {
      assertAnchorShape(value.previousAnchor);
    }
  } else {
    requireString(value.aliasNodeId, "Inline Alias Node identity");
  }
}

export function validateInlineReferenceMutation(mutation: InlineReferenceMutation, factIdentity: string): void {
  requireIdentity(mutation.inlineReferenceId, "Inline Reference", factIdentity);
  if (mutation.kind === "inline-reference-create") {
    requireIdentity(mutation.hostNodeId, "Inline Reference host Node", factIdentity);
    requireIdentity(mutation.targetNodeId, "Inline Reference target Node", factIdentity);
    validateAnchor(mutation.anchor, factIdentity);
  } else if (mutation.kind === "inline-reference-delete") {
    validateDeletionEvidence(mutation, factIdentity);
  } else {
    requireIdentity(mutation.aliasNodeId, "Inline Alias Node", factIdentity);
  }
}

function validateDeletionEvidence(
  mutation: Extract<InlineReferenceMutation, { kind: "inline-reference-delete" }>,
  factIdentity: string,
): void {
  if (
    mutation.previousHostNodeId === undefined ||
    mutation.previousTargetNodeId === undefined ||
    mutation.previousAnchor === undefined
  ) {
    throw new Error(`Inline Reference deletion lacks semantic evidence: ${factIdentity}`);
  }
  requireIdentity(mutation.previousHostNodeId, "previous Inline Reference host Node", factIdentity);
  requireIdentity(mutation.previousTargetNodeId, "previous Inline Reference target Node", factIdentity);
  validateAnchor(mutation.previousAnchor, factIdentity);
}

function assertAnchorShape(value: unknown): void {
  assertObject(value, "Inline Reference anchor");
  assertKeys(value, ["after", "before", "affinity", "fallback"], "Inline Reference anchor");
  assertNullableString(value.after, "Inline Reference anchor after");
  assertNullableString(value.before, "Inline Reference anchor before");
  assertOneOf(value.affinity, ["after", "before"], "Inline Reference anchor affinity");
  assertOneOf(value.fallback, ["start", "end"], "Inline Reference anchor fallback");
}

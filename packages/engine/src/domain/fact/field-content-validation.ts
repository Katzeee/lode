import type { Mutation } from "./types.js";
import { requireString } from "./shape-validation-primitives.js";

export function assertFieldContentDeletionShape(
  value: Record<string, unknown>,
  optionalAnchor: (value: unknown) => void,
): asserts value is Extract<
  Mutation,
  { kind: "field-value-delete" | "materialized-field-delete" }
> {
  requireString(value.ownerNodeId, "Field owner Node");
  requireString(value.fieldDefinitionId, "Field Definition");
  if (value.kind === "field-value-delete") {
    requireString(value.valueOccurrenceId, "Field Value Occurrence");
  } else {
    requireString(value.fieldNodeId, "Materialized Field Node");
    requireString(value.fieldOccurrenceId, "Materialized Field Occurrence");
  }
  if (value.previousParentNodeId !== undefined) {
    requireString(value.previousParentNodeId, "previous parent Node");
  }
  optionalAnchor(value.previousAnchor);
}

export function validateStaticFieldContentDeletion(
  mutation: Extract<Mutation, { kind: "field-value-delete" | "materialized-field-delete" }>,
  factIdentity: string,
): void {
  const identities = [
    mutation.ownerNodeId,
    mutation.fieldDefinitionId,
    mutation.kind === "field-value-delete"
      ? mutation.valueOccurrenceId
      : mutation.fieldOccurrenceId,
    ...(mutation.kind === "materialized-field-delete" ? [mutation.fieldNodeId] : []),
  ];
  if (identities.some((identity) => identity.length === 0)) {
    throw new Error(`Field content deletion identity is empty: ${factIdentity}`);
  }
  const anchor = mutation.previousAnchor;
  if (mutation.previousParentNodeId === undefined || !anchor) {
    throw new Error(`Field content deletion lacks semantic evidence: ${factIdentity}`);
  }
  if (anchor.after !== null && anchor.after === anchor.before) {
    throw new Error(`Sequence anchor repeats one identity: ${factIdentity}`);
  }
}

export function validateStaticFieldMaterialization(
  mutation: Extract<Mutation, { kind: "field-materialize" }>,
  factIdentity: string,
): void {
  if (
    [
      mutation.ownerNodeId,
      mutation.fieldDefinitionId,
      mutation.fieldNodeId,
      mutation.fieldOccurrenceId,
    ].some((identity) => identity.length === 0)
  ) {
    throw new Error(`Materialized Field identity is empty: ${factIdentity}`);
  }
}

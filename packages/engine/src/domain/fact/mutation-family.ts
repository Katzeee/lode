import type { FieldContentDeletionMutation } from "./field-content-types.js";
import type { Mutation } from "./types.js";

type MutationFamily = "node" | "occurrence" | "schema" | "template" | "field" | "text" | "value";

const MUTATION_FAMILY_BY_KIND = {
  "node-create": "node",
  "node-delete": "node",
  "node-restore": "node",
  "occurrence-create": "occurrence",
  "occurrence-delete": "occurrence",
  "occurrence-restore": "occurrence",
  "occurrence-move": "occurrence",
  "node-owner-set": "node",
  "node-type-declare": "node",
  "schema-apply": "schema",
  "schema-remove": "schema",
  "schema-field-add": "schema",
  "schema-field-remove": "schema",
  "schema-field-configure": "schema",
  "schema-extension-add": "schema",
  "schema-extension-remove": "schema",
  "schema-template-node-add": "schema",
  "schema-template-node-remove": "schema",
  "template-node-detach": "template",
  "field-materialize": "field",
  "field-value-delete": "field",
  "materialized-field-delete": "field",
  "field-initialize": "field",
  "text-splice": "text",
  "text-mark": "text",
  "value-set": "value",
  "value-unset": "value",
} as const satisfies Readonly<Record<Mutation["kind"], MutationFamily>>;

type MutationKindInFamily<Family extends MutationFamily> = {
  [Kind in Mutation["kind"]]: (typeof MUTATION_FAMILY_BY_KIND)[Kind] extends Family ? Kind : never;
}[Mutation["kind"]];

type MutationInFamily<Family extends MutationFamily> = Extract<
  Mutation,
  { kind: MutationKindInFamily<Family> }
>;

export type NodeMutation = MutationInFamily<"node">;
export type OccurrenceMutation = MutationInFamily<"occurrence">;
export type SchemaMutation = MutationInFamily<"schema">;
export type TemplateMutation = MutationInFamily<"template">;
export type FieldMutation = MutationInFamily<"field">;
export type TextMutation = MutationInFamily<"text">;
export type ValueMutation = MutationInFamily<"value">;

export function isNodeMutation(mutation: Mutation): mutation is NodeMutation {
  return MUTATION_FAMILY_BY_KIND[mutation.kind] === "node";
}

export function isOccurrenceMutation(mutation: Mutation): mutation is OccurrenceMutation {
  return MUTATION_FAMILY_BY_KIND[mutation.kind] === "occurrence";
}

export function isSchemaMutation(mutation: Mutation): mutation is SchemaMutation {
  return MUTATION_FAMILY_BY_KIND[mutation.kind] === "schema";
}

export function isTemplateMutation(mutation: Mutation): mutation is TemplateMutation {
  return MUTATION_FAMILY_BY_KIND[mutation.kind] === "template";
}

export function isFieldMutation(mutation: Mutation): mutation is FieldMutation {
  return MUTATION_FAMILY_BY_KIND[mutation.kind] === "field";
}

export function isTextMutation(mutation: Mutation): mutation is TextMutation {
  return MUTATION_FAMILY_BY_KIND[mutation.kind] === "text";
}

export function isValueMutation(mutation: Mutation): mutation is ValueMutation {
  return MUTATION_FAMILY_BY_KIND[mutation.kind] === "value";
}

export function isFieldContentDeletionMutation(
  mutation: Mutation,
): mutation is FieldContentDeletionMutation {
  return mutation.kind === "field-value-delete" || mutation.kind === "materialized-field-delete";
}

export function fieldContentDeletionOccurrenceId(mutation: FieldContentDeletionMutation): string {
  return mutation.kind === "field-value-delete"
    ? mutation.valueOccurrenceId
    : mutation.fieldOccurrenceId;
}

export function occurrenceRestoreDeletionId(mutation: Mutation | null): string | null {
  if (mutation?.kind === "occurrence-delete") {
    return mutation.occurrenceId;
  }
  return mutation && isFieldContentDeletionMutation(mutation)
    ? fieldContentDeletionOccurrenceId(mutation)
    : null;
}

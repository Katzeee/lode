import type { FieldContentDeletionMutation } from "./field-content-types.js";
import type { ContributionFact, Mutation } from "./types.js";

const MUTATION_KINDS_BY_FAMILY = {
  node: ["node-create", "node-delete", "node-restore", "node-owner-set", "node-type-declare"],
  occurrence: ["occurrence-create", "occurrence-delete", "occurrence-restore", "occurrence-move"],
  schema: [
    "schema-apply",
    "schema-remove",
    "schema-field-add",
    "schema-field-remove",
    "schema-field-configure",
    "schema-extension-add",
    "schema-extension-remove",
    "schema-template-node-add",
    "schema-template-node-remove",
  ],
  template: ["template-node-detach"],
  field: ["field-materialize", "field-value-delete", "materialized-field-delete", "field-initialize"],
  text: ["text-splice", "text-mark"],
  value: ["value-set", "value-unset"],
} as const satisfies Readonly<Record<string, readonly Mutation["kind"][]>>;

export type MutationFamily = keyof typeof MUTATION_KINDS_BY_FAMILY;

type ClassifiedMutationKind = (typeof MUTATION_KINDS_BY_FAMILY)[MutationFamily][number];
type AssertNever<Value extends never> = Value;
export type MutationFamilyCoverageIsComplete = AssertNever<Exclude<Mutation["kind"], ClassifiedMutationKind>>;

type MutationKindInFamily<Family extends MutationFamily> = {
  [Kind in Mutation["kind"]]: Kind extends (typeof MUTATION_KINDS_BY_FAMILY)[Family][number] ? Kind : never;
}[Mutation["kind"]];

type MutationInFamily<Family extends MutationFamily> = Extract<Mutation, { kind: MutationKindInFamily<Family> }>;

export type NodeMutation = MutationInFamily<"node">;
export type OccurrenceMutation = MutationInFamily<"occurrence">;
export type SchemaMutation = MutationInFamily<"schema">;
export type TemplateMutation = MutationInFamily<"template">;
export type FieldMutation = MutationInFamily<"field">;
export type TextMutation = MutationInFamily<"text">;
export type ValueMutation = MutationInFamily<"value">;

export function isNodeMutation(mutation: Mutation): mutation is NodeMutation {
  return mutationBelongsTo(mutation, "node");
}

export function isOccurrenceMutation(mutation: Mutation): mutation is OccurrenceMutation {
  return mutationBelongsTo(mutation, "occurrence");
}

export function isSchemaMutation(mutation: Mutation): mutation is SchemaMutation {
  return mutationBelongsTo(mutation, "schema");
}

export function isTemplateMutation(mutation: Mutation): mutation is TemplateMutation {
  return mutationBelongsTo(mutation, "template");
}

export function isFieldMutation(mutation: Mutation): mutation is FieldMutation {
  return mutationBelongsTo(mutation, "field");
}

export function isTextMutation(mutation: Mutation): mutation is TextMutation {
  return mutationBelongsTo(mutation, "text");
}

export function isValueMutation(mutation: Mutation): mutation is ValueMutation {
  return mutationBelongsTo(mutation, "value");
}

export type ContributionFactOf<Kind extends Mutation["kind"]> = ContributionFact &
  Readonly<{ body: Readonly<{ mutation: Extract<Mutation, { kind: Kind }> }> }>;

export function contributionFactsOfKind<Kind extends Mutation["kind"]>(
  facts: readonly ContributionFact[],
  kind: Kind,
): readonly ContributionFactOf<Kind>[] {
  return contributionFactsOfKinds(facts, [kind]);
}

export function contributionFactsOfKinds<Kind extends Mutation["kind"]>(
  facts: readonly ContributionFact[],
  kinds: readonly Kind[],
): readonly ContributionFactOf<Kind>[] {
  return facts.filter((fact): fact is ContributionFactOf<Kind> =>
    (kinds as readonly Mutation["kind"][]).includes(fact.body.mutation.kind),
  );
}

export function isFieldContentDeletionMutation(mutation: Mutation): mutation is FieldContentDeletionMutation {
  return mutation.kind === "field-value-delete" || mutation.kind === "materialized-field-delete";
}

export function fieldContentDeletionOccurrenceId(mutation: FieldContentDeletionMutation): string {
  return mutation.kind === "field-value-delete" ? mutation.valueOccurrenceId : mutation.fieldOccurrenceId;
}

export function occurrenceRestoreDeletionId(mutation: Mutation | null): string | null {
  if (mutation?.kind === "occurrence-delete") {
    return mutation.occurrenceId;
  }
  return mutation && isFieldContentDeletionMutation(mutation) ? fieldContentDeletionOccurrenceId(mutation) : null;
}

function mutationBelongsTo<Family extends MutationFamily>(
  mutation: Mutation,
  family: Family,
): mutation is MutationInFamily<Family> {
  return (MUTATION_KINDS_BY_FAMILY[family] as readonly Mutation["kind"][]).includes(mutation.kind);
}

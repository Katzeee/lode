import type { FieldContentDeletionMutation } from "./field-content-types.js";
import type { ContributionFact, Mutation } from "./types.js";

const MUTATION_KINDS_BY_FAMILY = {
  node: ["node-create", "node-delete", "node-restore", "node-owner-set", "node-type-declare"],
  configuration: ["metanode-attach"],
  occurrence: ["occurrence-create", "occurrence-delete", "occurrence-restore", "occurrence-move"],
  supertag: [
    "supertag-apply",
    "supertag-remove",
    "supertag-field-add",
    "supertag-field-remove",
    "supertag-field-configure",
    "supertag-extension-add",
    "supertag-extension-remove",
    "supertag-template-node-add",
    "supertag-template-node-remove",
  ],
  template: ["template-node-detach"],
  field: ["field-materialize", "field-value-delete", "materialized-field-delete", "field-initialize"],
  fieldDefinition: [
    "field-datatype-configure",
    "field-cardinality-configure",
    "field-initialization-expression-configure",
  ],
  text: ["text-splice", "text-mark"],
  inlineReference: [
    "inline-reference-create",
    "inline-reference-delete",
    "inline-reference-alias-attach",
    "inline-reference-alias-detach",
  ],
  search: ["search-supertag-clause-attach", "search-field-clause-attach"],
  view: ["shared-default-view-definition-attach", "shared-default-view-definition-mode-set"],
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
export type MetanodeMutation = MutationInFamily<"configuration">;
export type OccurrenceMutation = MutationInFamily<"occurrence">;
export type SupertagMutation = MutationInFamily<"supertag">;
export type TemplateMutation = MutationInFamily<"template">;
export type FieldMutation = MutationInFamily<"field">;
export type FieldDefinitionConfigMutation = MutationInFamily<"fieldDefinition">;
export type TextMutation = MutationInFamily<"text">;
export type InlineReferenceMutation = MutationInFamily<"inlineReference">;
export type SearchClauseMutation = MutationInFamily<"search">;
export type ViewMutation = MutationInFamily<"view">;

export function isNodeMutation(mutation: Mutation): mutation is NodeMutation {
  return mutationBelongsTo(mutation, "node");
}

export function isMetanodeMutation(mutation: Mutation): mutation is MetanodeMutation {
  return mutationBelongsTo(mutation, "configuration");
}

export function isOccurrenceMutation(mutation: Mutation): mutation is OccurrenceMutation {
  return mutationBelongsTo(mutation, "occurrence");
}

export function isSupertagMutation(mutation: Mutation): mutation is SupertagMutation {
  return mutationBelongsTo(mutation, "supertag");
}

export function isTemplateMutation(mutation: Mutation): mutation is TemplateMutation {
  return mutationBelongsTo(mutation, "template");
}

export function isFieldMutation(mutation: Mutation): mutation is FieldMutation {
  return mutationBelongsTo(mutation, "field");
}

export function isFieldDefinitionConfigMutation(mutation: Mutation): mutation is FieldDefinitionConfigMutation {
  return mutationBelongsTo(mutation, "fieldDefinition");
}

export function isTextMutation(mutation: Mutation): mutation is TextMutation {
  return mutationBelongsTo(mutation, "text");
}

export function isInlineReferenceMutation(mutation: Mutation): mutation is InlineReferenceMutation {
  return mutationBelongsTo(mutation, "inlineReference");
}

export function isSearchMutation(mutation: Mutation): mutation is SearchClauseMutation {
  return mutationBelongsTo(mutation, "search");
}

export function isViewMutation(mutation: Mutation): mutation is ViewMutation {
  return mutationBelongsTo(mutation, "view");
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

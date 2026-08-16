import type {
  FieldCardinality,
  FieldDatatype,
  FieldInitializationExpression,
  Mutation,
  NodeType,
  NodeSeed,
  SequenceAnchor,
  ViewType,
} from "../fact/index.js";

const MUTATION_EDIT_ACCESS = {
  "node-create": "composite",
  "node-delete": "direct",
  "node-restore": "direct",
  "occurrence-create": "direct",
  "occurrence-delete": "direct",
  "occurrence-restore": "direct",
  "occurrence-move": "direct",
  "node-owner-set": "internal",
  "metanode-attach": "internal",
  "node-type-declare": "direct",
  "supertag-apply": "direct",
  "supertag-remove": "direct",
  "supertag-field-add": "direct",
  "supertag-field-remove": "direct",
  "supertag-field-configure": "direct",
  "supertag-extension-add": "direct",
  "supertag-extension-remove": "direct",
  "supertag-template-node-add": "direct",
  "supertag-template-node-remove": "direct",
  "template-node-detach": "direct",
  "field-materialize": "direct",
  "field-value-delete": "direct",
  "materialized-field-delete": "direct",
  "field-initialize": "internal",
  "field-datatype-configure": "direct",
  "field-cardinality-configure": "direct",
  "field-initialization-expression-configure": "direct",
  "text-splice": "direct",
  "text-mark": "direct",
  "inline-reference-create": "direct",
  "inline-reference-delete": "direct",
  "inline-reference-alias-attach": "direct",
  "inline-reference-alias-detach": "direct",
  "search-supertag-clause-attach": "internal",
  "search-field-clause-attach": "internal",
  "shared-default-view-definition-attach": "internal",
  "shared-default-view-definition-mode-set": "direct",
} as const satisfies Readonly<Record<Mutation["kind"], "direct" | "composite" | "internal">>;

export const PREPARED_MUTATION_EVIDENCE_KEYS = [
  "deletedAtoms",
  "observedConfigFactIds",
  "observedInitializationFactIds",
  "observedValueFactIds",
  "observedModeFactIds",
  "previous",
  "previousAnchor",
  "previousConfig",
  "previousOwnerNodeId",
  "previousDatatype",
  "previousCardinality",
  "previousExpression",
  "previousParentNodeId",
  "previousHostNodeId",
  "previousViewType",
  "previousTargetNodeId",
  "sourceApplicationSupertagIds",
  "sourceSupertagIds",
  "sourceTemplateOccurrenceIds",
] as const;

export type CreateNodeEdit = Readonly<{
  kind: "node-create";
  nodeId: string;
  occurrenceId: string;
  parentNodeId: string;
  anchor: SequenceAnchor;
  seed?: NodeSeed;
  nodeType?: NodeType;
}>;

export type PromoteReferenceEdit = Readonly<{
  kind: "reference-promote";
  occurrenceId: string;
}>;

export type CreateInlineReferenceAliasEdit = Readonly<{
  kind: "inline-reference-alias-create";
  inlineReferenceId: string;
  hostNodeId: string;
  metanodeId: string;
  aliasNodeId: string;
  aliasOccurrenceId: string;
  seed?: NodeSeed;
}>;

type SearchClauseCreateEditBase = Readonly<{
  searchNodeId: string;
  metanodeId: string;
  clauseNodeId: string;
  clauseOccurrenceId: string;
  anchor: SequenceAnchor;
  seed?: NodeSeed;
}>;

export type CreateSearchSupertagClauseEdit = SearchClauseCreateEditBase &
  Readonly<{ kind: "search-supertag-clause-create"; supertagId: string }>;

export type CreateSearchFieldClauseEdit = SearchClauseCreateEditBase &
  Readonly<{ kind: "search-field-clause-create"; fieldDefinitionId: string }>;

export type CreateSharedDefaultViewDefinitionEdit = Readonly<{
  kind: "shared-default-view-definition-create";
  hostNodeId: string;
  metanodeId: string;
  viewDefinitionNodeId: string;
  viewDefinitionOccurrenceId: string;
  viewType: ViewType;
  anchor: SequenceAnchor;
  seed?: NodeSeed;
}>;

type CreateFieldDefinitionConfigurationEditBase = Readonly<{
  fieldDefinitionId: string;
  metanodeId: string;
  configurationNodeId: string;
  configurationOccurrenceId: string;
  anchor: SequenceAnchor;
  seed?: NodeSeed;
}>;

export type CreateFieldDefinitionConfigurationEdit =
  | (CreateFieldDefinitionConfigurationEditBase &
      Readonly<{ kind: "field-datatype-configuration-create"; datatype: FieldDatatype }>)
  | (CreateFieldDefinitionConfigurationEditBase &
      Readonly<{ kind: "field-cardinality-configuration-create"; cardinality: FieldCardinality }>)
  | (CreateFieldDefinitionConfigurationEditBase &
      Readonly<{
        kind: "field-initialization-expression-configuration-create";
        expression: FieldInitializationExpression;
      }>);

type PreparedEvidence = (typeof PREPARED_MUTATION_EVIDENCE_KEYS)[number];
type DirectEditMutationKind = {
  [Kind in Mutation["kind"]]: (typeof MUTATION_EDIT_ACCESS)[Kind] extends "direct" ? Kind : never;
}[Mutation["kind"]];

type UnpreparedMutation<M extends Mutation> = M extends Mutation ? Readonly<Omit<M, PreparedEvidence>> : never;

type UnpreparedMutations<M extends Mutation> = M extends Mutation ? UnpreparedMutation<M> : never;

type FactMutationEdit = UnpreparedMutations<Extract<Mutation, { kind: DirectEditMutationKind }>>;

export type EditMutation =
  | FactMutationEdit
  | CreateNodeEdit
  | PromoteReferenceEdit
  | CreateInlineReferenceAliasEdit
  | CreateSearchSupertagClauseEdit
  | CreateSearchFieldClauseEdit
  | CreateSharedDefaultViewDefinitionEdit
  | CreateFieldDefinitionConfigurationEdit;
type ExpandableEdit = Exclude<
  EditMutation,
  | PromoteReferenceEdit
  | CreateInlineReferenceAliasEdit
  | CreateSearchSupertagClauseEdit
  | CreateSearchFieldClauseEdit
  | CreateSharedDefaultViewDefinitionEdit
  | CreateFieldDefinitionConfigurationEdit
>;

export function isFactMutationEdit(mutation: Mutation): mutation is FactMutationEdit {
  return MUTATION_EDIT_ACCESS[mutation.kind] === "direct";
}

export type MutationWrite =
  | Readonly<{ kind: "single"; mutation: Mutation }>
  | Readonly<{ kind: "atomic"; mutations: readonly [Mutation, ...Mutation[]] }>;

export function singleMutationWrite(mutation: Mutation): MutationWrite {
  return { kind: "single", mutation };
}

export function atomicMutationWrite(mutations: readonly [Mutation, ...Mutation[]]): MutationWrite {
  return { kind: "atomic", mutations };
}

export function mutationWriteMembers(write: MutationWrite): readonly [Mutation, ...Mutation[]] {
  return write.kind === "single" ? [write.mutation] : write.mutations;
}

export function expandEditMutation(edit: ExpandableEdit): MutationWrite {
  if (edit.kind !== "node-create") {
    return singleMutationWrite(edit);
  }
  const { occurrenceId, parentNodeId, anchor, nodeType, ...identity } = edit;
  return atomicMutationWrite([
    identity,
    {
      kind: "occurrence-create",
      occurrenceId,
      nodeId: edit.nodeId,
      parentNodeId,
      anchor,
    },
    ...(nodeType === undefined ? [] : ([{ kind: "node-type-declare", nodeId: edit.nodeId, nodeType }] as const)),
  ]);
}

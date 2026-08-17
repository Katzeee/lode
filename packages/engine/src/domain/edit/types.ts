import type {
  Mutation,
  IntrinsicNodeType,
  NodeSeed,
  SearchExpressionSpec,
  SequenceAnchor,
  ViewOptionsSpec,
  ViewType,
} from "../fact/index.js";
import type {
  CodeNodeConfigureEdit,
  DebugNodeOpenEdit,
  FieldValueCreateEdit,
  SharedDefaultViewDefinitionSortByNameCreateEdit,
  UrlNodeCreateEdit,
} from "./breadth-edit-types.js";
import type {
  AddExistingSupertagTemplateFieldEdit,
  AddSupertagOptionalFieldContributionEdit,
  CreateSupertagTemplateFieldEdit,
  MakeSupertagTemplateFieldDiscoverableEdit,
  RemoveSupertagTemplateFieldEdit,
  SetSupertagTemplateFieldStaticDefaultEdit,
  SetSupertagTemplateFieldVisibilityEdit,
} from "./template-field-edit-types.js";
import type {
  ConfigureFieldDefinitionEndpointEdit,
  CreateFieldDefinitionConfigurationEdit,
} from "./field-definition-configuration-edit-types.js";
import type { TypedFieldValueEdit } from "./typed-field-value-edit-types.js";
export type {
  ConfigureFieldDefinitionEndpointEdit,
  CreateFieldDefinitionConfigurationEdit,
} from "./field-definition-configuration-edit-types.js";

const MUTATION_EDIT_ACCESS = {
  "node-create": "composite",
  "node-delete": "composite",
  "node-restore": "composite",
  "occurrence-create": "direct",
  "occurrence-delete": "direct",
  "occurrence-restore": "direct",
  "occurrence-move": "direct",
  "node-owner-set": "internal",
  "metanode-attach": "internal",
  "intrinsic-node-type-declare": "direct",
  "supertag-apply": "internal",
  "supertag-remove": "direct",
  "supertag-extension-add": "direct",
  "supertag-extension-remove": "direct",
  "supertag-template-node-add": "direct",
  "supertag-template-node-remove": "direct",
  "supertag-template-field-attach": "internal",
  "supertag-template-field-existing-attach": "internal",
  "supertag-template-field-detach": "internal",
  "supertag-template-field-discoverability-set": "internal",
  "supertag-template-field-visibility-configure": "internal",
  "supertag-optional-field-contribution-attach": "internal",
  "supertag-optional-field-contribution-detach": "internal",
  "template-node-detach": "direct",
  "field-materialize": "direct",
  "field-value-delete": "direct",
  "materialized-field-delete": "direct",
  "field-datatype-configure": "composite",
  "field-cardinality-configure": "composite",
  "field-optionality-configure": "composite",
  "field-initialization-expression-configure": "internal",
  "text-splice": "direct",
  "text-mark": "direct",
  "inline-reference-create": "direct",
  "inline-reference-delete": "direct",
  "inline-reference-alias-attach": "direct",
  "inline-reference-alias-detach": "direct",
  "search-expression-attach": "internal",
  "search-expression-detach": "internal",
  "shared-default-view-definition-attach": "internal",
  "shared-default-view-definition-detach": "internal",
  "shared-default-view-definition-mode-set": "direct",
  "shared-default-view-definition-sort-by-name-set": "internal",
  "shared-default-view-definition-options-set": "internal",
} as const satisfies Readonly<Record<Mutation["kind"], "direct" | "composite" | "internal">>;

export const PREPARED_MUTATION_EVIDENCE_KEYS = [
  "deletedAtoms",
  "observedValueFactIds",
  "observedModeFactIds",
  "previous",
  "previousAnchor",
  "previousOwnerNodeId",
  "previousDatatypeNodeId",
  "previousCardinalityNodeId",
  "previousOptionalityNodeId",
  "previousExpression",
  "previousParentNodeId",
  "previousHostNodeId",
  "previousViewType",
  "previousVisibility",
  "previousOptions",
  "observedOptionsFactIds",
  "observedVisibilityFactIds",
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
  intrinsicNodeType?: IntrinsicNodeType;
}>;

export type DeleteNodeEdit = Readonly<{
  kind: "node-delete";
  nodeId: string;
}>;

export type RestoreNodeEdit = Readonly<{
  kind: "node-restore";
  nodeId: string;
  deletionFactId: string;
  occurrenceId: string;
  ownerNodeId: string;
  parentNodeId: string;
  anchor: SequenceAnchor;
}>;

export type PromoteReferenceEdit = Readonly<{
  kind: "reference-promote";
  occurrenceId: string;
}>;

export type CreateSupertagApplicationEdit = Readonly<{
  kind: "supertag-application-create";
  hostNodeId: string;
  metanodeId: string;
  supertagId: string;
  applicationNodeId: string;
  applicationOccurrenceId: string;
  relationDefinitionOccurrenceId: string;
  definitionOccurrenceId: string;
  anchor: SequenceAnchor;
  seed?: NodeSeed;
}>;

export type CreateInlineReferenceAliasEdit = Readonly<{
  kind: "inline-reference-alias-create";
  inlineReferenceId: string;
  hostNodeId: string;
  aliasNodeId: string;
  seed?: NodeSeed;
}>;

export type CreateSearchExpressionEdit = Readonly<{
  kind: "search-expression-create";
  searchNodeId: string;
  metanodeId: string;
  expressionNodeId: string;
  expressionOccurrenceId: string;
  definitionOccurrenceId: string;
  expression: SearchExpressionSpec;
  anchor: SequenceAnchor;
  seed?: NodeSeed;
}>;

export type UpdateSearchExpressionEdit = Readonly<{
  kind: "search-expression-update";
  searchNodeId: string;
  expression: SearchExpressionSpec;
}>;

export type CreateSharedDefaultViewDefinitionEdit = Readonly<{
  kind: "shared-default-view-definition-create";
  hostNodeId: string;
  metanodeId: string;
  attachmentNodeId: string;
  attachmentOccurrenceId: string;
  relationDefinitionOccurrenceId: string;
  viewDefinitionNodeId: string;
  viewDefinitionOccurrenceId: string;
  viewType: ViewType;
  anchor: SequenceAnchor;
  seed?: NodeSeed;
}>;

export type RemoveSharedDefaultViewDefinitionEdit = Readonly<{
  kind: "shared-default-view-definition-remove";
  hostNodeId: string;
  attachmentNodeId: string;
  attachmentOccurrenceId: string;
  relationDefinitionOccurrenceId: string;
  viewDefinitionNodeId: string;
  viewDefinitionOccurrenceId: string;
}>;

export type UpdateSharedDefaultViewDefinitionOptionsEdit = Readonly<{
  kind: "shared-default-view-definition-options-update";
  hostNodeId: string;
  viewDefinitionNodeId: string;
  options: ViewOptionsSpec;
}>;

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
  | DeleteNodeEdit
  | RestoreNodeEdit
  | CreateSupertagApplicationEdit
  | CreateSupertagTemplateFieldEdit
  | AddExistingSupertagTemplateFieldEdit
  | MakeSupertagTemplateFieldDiscoverableEdit
  | RemoveSupertagTemplateFieldEdit
  | SetSupertagTemplateFieldStaticDefaultEdit
  | SetSupertagTemplateFieldVisibilityEdit
  | AddSupertagOptionalFieldContributionEdit
  | PromoteReferenceEdit
  | CreateInlineReferenceAliasEdit
  | CreateSearchExpressionEdit
  | UpdateSearchExpressionEdit
  | CreateSharedDefaultViewDefinitionEdit
  | RemoveSharedDefaultViewDefinitionEdit
  | UpdateSharedDefaultViewDefinitionOptionsEdit
  | CreateFieldDefinitionConfigurationEdit
  | ConfigureFieldDefinitionEndpointEdit
  | DebugNodeOpenEdit
  | FieldValueCreateEdit
  | UrlNodeCreateEdit
  | CodeNodeConfigureEdit
  | SharedDefaultViewDefinitionSortByNameCreateEdit
  | TypedFieldValueEdit;
type ExpandableEdit = Exclude<
  EditMutation,
  | PromoteReferenceEdit
  | DeleteNodeEdit
  | RestoreNodeEdit
  | CreateSupertagApplicationEdit
  | CreateSupertagTemplateFieldEdit
  | AddExistingSupertagTemplateFieldEdit
  | MakeSupertagTemplateFieldDiscoverableEdit
  | RemoveSupertagTemplateFieldEdit
  | SetSupertagTemplateFieldStaticDefaultEdit
  | SetSupertagTemplateFieldVisibilityEdit
  | AddSupertagOptionalFieldContributionEdit
  | CreateInlineReferenceAliasEdit
  | CreateSearchExpressionEdit
  | UpdateSearchExpressionEdit
  | CreateSharedDefaultViewDefinitionEdit
  | RemoveSharedDefaultViewDefinitionEdit
  | UpdateSharedDefaultViewDefinitionOptionsEdit
  | CreateFieldDefinitionConfigurationEdit
  | ConfigureFieldDefinitionEndpointEdit
  | DebugNodeOpenEdit
  | FieldValueCreateEdit
  | UrlNodeCreateEdit
  | CodeNodeConfigureEdit
  | SharedDefaultViewDefinitionSortByNameCreateEdit
  | TypedFieldValueEdit
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
  const { occurrenceId, parentNodeId, anchor, intrinsicNodeType, ...identity } = edit;
  return atomicMutationWrite([
    identity,
    {
      kind: "node-owner-set",
      nodeId: edit.nodeId,
      ownerNodeId: parentNodeId,
      previousOwnerNodeId: null,
    },
    {
      kind: "occurrence-create",
      occurrenceId,
      nodeId: edit.nodeId,
      parentNodeId,
      anchor,
    },
    ...(intrinsicNodeType === undefined
      ? []
      : ([{ kind: "intrinsic-node-type-declare", nodeId: edit.nodeId, intrinsicNodeType }] as const)),
  ]);
}

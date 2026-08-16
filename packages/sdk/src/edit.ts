import type {
  FieldMaterializeMutation as ProtocolFieldMaterializeMutation,
  FieldValueDeleteMutation as ProtocolFieldValueDeleteMutation,
  MaterializedFieldDeleteMutation as ProtocolMaterializedFieldDeleteMutation,
  NodeCreateMutation as ProtocolNodeCreateMutation,
  NodeDeleteMutation as ProtocolNodeDeleteMutation,
  NodeRestoreMutation as ProtocolNodeRestoreMutation,
  NodeTypeDeclareMutation as ProtocolNodeTypeDeclareMutation,
  OccurrenceCreateMutation as ProtocolOccurrenceCreateMutation,
  OccurrenceDeleteMutation as ProtocolOccurrenceDeleteMutation,
  OccurrenceMoveMutation as ProtocolOccurrenceMoveMutation,
  OccurrenceRestoreMutation as ProtocolOccurrenceRestoreMutation,
  ReferencePromoteMutation as ProtocolReferencePromoteMutation,
  SupertagApplyMutation as ProtocolSupertagApplyMutation,
  SupertagExtensionAddMutation as ProtocolSupertagExtensionAddMutation,
  SupertagExtensionRemoveMutation as ProtocolSupertagExtensionRemoveMutation,
  SupertagFieldAddMutation as ProtocolSupertagFieldAddMutation,
  SupertagFieldConfigureMutation as ProtocolSupertagFieldConfigureMutation,
  SupertagFieldRemoveMutation as ProtocolSupertagFieldRemoveMutation,
  SupertagRemoveMutation as ProtocolSupertagRemoveMutation,
  SupertagTemplateNodeAddMutation as ProtocolSupertagTemplateNodeAddMutation,
  SupertagTemplateNodeRemoveMutation as ProtocolSupertagTemplateNodeRemoveMutation,
  TemplateNodeDetachMutation as ProtocolTemplateNodeDetachMutation,
  TextMarkMutation as ProtocolTextMarkMutation,
  TextSpliceMutation as ProtocolTextSpliceMutation,
  InlineReferenceCreateMutation as ProtocolInlineReferenceCreateMutation,
  InlineReferenceDeleteMutation as ProtocolInlineReferenceDeleteMutation,
  InlineReferenceAliasAttachMutation as ProtocolInlineReferenceAliasAttachMutation,
  InlineReferenceAliasDetachMutation as ProtocolInlineReferenceAliasDetachMutation,
  InlineReferenceAliasCreateMutation as ProtocolInlineReferenceAliasCreateMutation,
  SearchSupertagClauseCreateMutation as ProtocolSearchSupertagClauseCreateMutation,
  SearchFieldClauseCreateMutation as ProtocolSearchFieldClauseCreateMutation,
  SharedDefaultViewDefinitionCreateMutation as ProtocolSharedDefaultViewDefinitionCreateMutation,
  SharedDefaultViewDefinitionModeSetMutation as ProtocolSharedDefaultViewDefinitionModeSetMutation,
  FieldDatatypeConfigureMutation as ProtocolFieldDatatypeConfigureMutation,
  FieldCardinalityConfigureMutation as ProtocolFieldCardinalityConfigureMutation,
  FieldInitializationExpressionConfigureMutation as ProtocolFieldInitializationExpressionConfigureMutation,
  FieldDatatypeConfigurationCreateMutation as ProtocolFieldDatatypeConfigurationCreateMutation,
  FieldCardinalityConfigurationCreateMutation as ProtocolFieldCardinalityConfigurationCreateMutation,
  FieldInitializationExpressionConfigurationCreateMutation as ProtocolFieldInitializationExpressionConfigurationCreateMutation,
} from "@lode/protocol/dto/edit";
import type {
  SupertagFieldConfig,
  JsonValue,
  NodeSeed,
  NodeType,
  PreviousValue,
  ProtocolDto,
  SequenceAnchor,
  TextAtomId,
  ViewType,
  FieldDatatype,
  FieldCardinality,
  FieldInitializationExpression,
} from "./model.js";

type WithKind<Value, Kind extends string> = Omit<ProtocolDto<Value>, "kind"> & Readonly<{ kind: Kind }>;

type NodeCreateMutation = Omit<WithKind<ProtocolNodeCreateMutation, "node-create">, "anchor" | "seed" | "nodeType"> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed; nodeType?: NodeType }>;
type SupertagFieldConfigureMutation = Omit<
  WithKind<ProtocolSupertagFieldConfigureMutation, "supertag-field-configure">,
  "config"
> &
  Readonly<{ config: SupertagFieldConfig }>;
type TemplateNodeDetachMutation = Omit<
  WithKind<ProtocolTemplateNodeDetachMutation, "template-node-detach">,
  "anchor" | "sourceSupertagIds" | "sourceApplicationSupertagIds" | "sourceTemplateOccurrenceIds"
> &
  Readonly<{
    anchor: SequenceAnchor;
    sourceSupertagIds?: readonly string[];
    sourceApplicationSupertagIds?: readonly string[];
    sourceTemplateOccurrenceIds?: readonly string[];
  }>;
type TextSpliceMutation = Omit<
  WithKind<ProtocolTextSpliceMutation, "text-splice">,
  "anchor" | "deleteAtomIds" | "attributes"
> &
  Readonly<{
    anchor: SequenceAnchor;
    deleteAtomIds: readonly TextAtomId[];
    attributes?: Readonly<Record<string, JsonValue>>;
  }>;
type TextMarkMutation = Omit<WithKind<ProtocolTextMarkMutation, "text-mark">, "atomIds" | "value"> &
  Readonly<{ atomIds: readonly TextAtomId[]; value: PreviousValue }>;
type InlineReferenceCreateMutation = Omit<
  WithKind<ProtocolInlineReferenceCreateMutation, "inline-reference-create">,
  "anchor"
> &
  Readonly<{ anchor: SequenceAnchor }>;
type InlineReferenceAliasCreateMutation = Omit<
  WithKind<ProtocolInlineReferenceAliasCreateMutation, "inline-reference-alias-create">,
  "seed"
> &
  Readonly<{ seed?: NodeSeed }>;
type SearchSupertagClauseCreateMutation = Omit<
  WithKind<ProtocolSearchSupertagClauseCreateMutation, "search-supertag-clause-create">,
  "anchor" | "seed"
> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed }>;
type SearchFieldClauseCreateMutation = Omit<
  WithKind<ProtocolSearchFieldClauseCreateMutation, "search-field-clause-create">,
  "anchor" | "seed"
> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed }>;
type SharedDefaultViewDefinitionCreateMutation = Omit<
  WithKind<ProtocolSharedDefaultViewDefinitionCreateMutation, "shared-default-view-definition-create">,
  "anchor" | "seed" | "viewType"
> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed; viewType: ViewType }>;
type SharedDefaultViewDefinitionModeSetMutation = Omit<
  WithKind<ProtocolSharedDefaultViewDefinitionModeSetMutation, "shared-default-view-definition-mode-set">,
  "viewType" | "previousViewType" | "observedModeFactIds"
> &
  Readonly<{ viewType: ViewType }>;
type FieldDatatypeConfigureMutation = Omit<
  WithKind<ProtocolFieldDatatypeConfigureMutation, "field-datatype-configure">,
  "datatype"
> &
  Readonly<{ datatype: FieldDatatype }>;
type FieldCardinalityConfigureMutation = Omit<
  WithKind<ProtocolFieldCardinalityConfigureMutation, "field-cardinality-configure">,
  "cardinality"
> &
  Readonly<{ cardinality: FieldCardinality }>;
type FieldInitializationExpressionConfigureMutation = Omit<
  WithKind<ProtocolFieldInitializationExpressionConfigureMutation, "field-initialization-expression-configure">,
  "expression"
> &
  Readonly<{ expression: FieldInitializationExpression }>;
type FieldDatatypeConfigurationCreateMutation = Omit<
  WithKind<ProtocolFieldDatatypeConfigurationCreateMutation, "field-datatype-configuration-create">,
  "datatype" | "anchor" | "seed"
> &
  Readonly<{ datatype: FieldDatatype; anchor: SequenceAnchor; seed?: NodeSeed }>;
type FieldCardinalityConfigurationCreateMutation = Omit<
  WithKind<ProtocolFieldCardinalityConfigurationCreateMutation, "field-cardinality-configuration-create">,
  "cardinality" | "anchor" | "seed"
> &
  Readonly<{ cardinality: FieldCardinality; anchor: SequenceAnchor; seed?: NodeSeed }>;
type FieldInitializationExpressionConfigurationCreateMutation = Omit<
  WithKind<
    ProtocolFieldInitializationExpressionConfigurationCreateMutation,
    "field-initialization-expression-configuration-create"
  >,
  "expression" | "anchor" | "seed"
> &
  Readonly<{ expression: FieldInitializationExpression; anchor: SequenceAnchor; seed?: NodeSeed }>;

export type EditMutation =
  | NodeCreateMutation
  | WithKind<ProtocolReferencePromoteMutation, "reference-promote">
  | WithKind<ProtocolNodeDeleteMutation, "node-delete">
  | WithKind<ProtocolNodeRestoreMutation, "node-restore">
  | (Omit<WithKind<ProtocolOccurrenceCreateMutation, "occurrence-create">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolOccurrenceDeleteMutation, "occurrence-delete">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolOccurrenceRestoreMutation, "occurrence-restore">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolOccurrenceMoveMutation, "occurrence-move">, "anchor" | "previousAnchor"> &
      Readonly<{ anchor: SequenceAnchor; previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolNodeTypeDeclareMutation, "node-type-declare">, "nodeType"> &
      Readonly<{ nodeType: NodeType }>)
  | (Omit<WithKind<ProtocolSupertagApplyMutation, "supertag-apply">, "anchor"> & Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSupertagRemoveMutation, "supertag-remove">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSupertagFieldAddMutation, "supertag-field-add">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSupertagFieldRemoveMutation, "supertag-field-remove">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | SupertagFieldConfigureMutation
  | (Omit<WithKind<ProtocolSupertagExtensionAddMutation, "supertag-extension-add">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSupertagExtensionRemoveMutation, "supertag-extension-remove">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSupertagTemplateNodeAddMutation, "supertag-template-node-add">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSupertagTemplateNodeRemoveMutation, "supertag-template-node-remove">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | TemplateNodeDetachMutation
  | WithKind<ProtocolFieldMaterializeMutation, "field-materialize">
  | (Omit<WithKind<ProtocolFieldValueDeleteMutation, "field-value-delete">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolMaterializedFieldDeleteMutation, "materialized-field-delete">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | TextSpliceMutation
  | TextMarkMutation
  | InlineReferenceCreateMutation
  | WithKind<ProtocolInlineReferenceDeleteMutation, "inline-reference-delete">
  | WithKind<ProtocolInlineReferenceAliasAttachMutation, "inline-reference-alias-attach">
  | WithKind<ProtocolInlineReferenceAliasDetachMutation, "inline-reference-alias-detach">
  | InlineReferenceAliasCreateMutation
  | SearchSupertagClauseCreateMutation
  | SearchFieldClauseCreateMutation
  | SharedDefaultViewDefinitionCreateMutation
  | SharedDefaultViewDefinitionModeSetMutation
  | FieldDatatypeConfigureMutation
  | FieldCardinalityConfigureMutation
  | FieldInitializationExpressionConfigureMutation
  | FieldDatatypeConfigurationCreateMutation
  | FieldCardinalityConfigurationCreateMutation
  | FieldInitializationExpressionConfigurationCreateMutation;

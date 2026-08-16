import type {
  FieldMaterializeMutation as ProtocolFieldMaterializeMutation,
  FieldValueDeleteMutation as ProtocolFieldValueDeleteMutation,
  MaterializedFieldDeleteMutation as ProtocolMaterializedFieldDeleteMutation,
  NodeDeleteMutation as ProtocolNodeDeleteMutation,
  NodeRestoreMutation as ProtocolNodeRestoreMutation,
  NodeTypeDeclareMutation as ProtocolNodeTypeDeclareMutation,
  OccurrenceCreateMutation as ProtocolOccurrenceCreateMutation,
  OccurrenceDeleteMutation as ProtocolOccurrenceDeleteMutation,
  OccurrenceMoveMutation as ProtocolOccurrenceMoveMutation,
  OccurrenceRestoreMutation as ProtocolOccurrenceRestoreMutation,
  SupertagApplyMutation as ProtocolSupertagApplyMutation,
  SupertagExtensionAddMutation as ProtocolSupertagExtensionAddMutation,
  SupertagExtensionRemoveMutation as ProtocolSupertagExtensionRemoveMutation,
  SupertagFieldAddMutation as ProtocolSupertagFieldAddMutation,
  SupertagFieldRemoveMutation as ProtocolSupertagFieldRemoveMutation,
  SupertagRemoveMutation as ProtocolSupertagRemoveMutation,
  SupertagTemplateNodeAddMutation as ProtocolSupertagTemplateNodeAddMutation,
  SupertagTemplateNodeRemoveMutation as ProtocolSupertagTemplateNodeRemoveMutation,
  TemplateNodeDetachMutation as ProtocolTemplateNodeDetachMutation,
  SearchSupertagClauseAttachMutation as ProtocolSearchSupertagClauseAttachMutation,
  SearchFieldClauseAttachMutation as ProtocolSearchFieldClauseAttachMutation,
  SharedDefaultViewDefinitionAttachMutation as ProtocolSharedDefaultViewDefinitionAttachMutation,
  SharedDefaultViewDefinitionModeSetMutation as ProtocolSharedDefaultViewDefinitionModeSetMutation,
} from "@lode/protocol/dto/edit";
import type {
  ContributionNodeCreateMutation as ProtocolContributionNodeCreateMutation,
  ContributionSupertagFieldConfigureMutation as ProtocolContributionSupertagFieldConfigureMutation,
  ContributionTextMarkMutation as ProtocolContributionTextMarkMutation,
  ContributionTextSpliceMutation as ProtocolContributionTextSpliceMutation,
  FieldInitializeMutation as ProtocolFieldInitializeMutation,
  InitializedReferenceFieldValue as ProtocolInitializedReferenceFieldValue,
  InitializedTextFieldValue as ProtocolInitializedTextFieldValue,
  NodeOwnerSetMutation as ProtocolNodeOwnerSetMutation,
  MetanodeAttachMutation as ProtocolMetanodeAttachMutation,
  ContributionInlineReferenceDeleteMutation as ProtocolContributionInlineReferenceDeleteMutation,
  ContributionFieldDatatypeConfigureMutation as ProtocolContributionFieldDatatypeConfigureMutation,
  ContributionFieldCardinalityConfigureMutation as ProtocolContributionFieldCardinalityConfigureMutation,
  ContributionFieldInitializationExpressionConfigureMutation as ProtocolContributionFieldInitializationExpressionConfigureMutation,
} from "@lode/protocol/dto/fact";
import type {
  InlineReferenceAliasAttachMutation as ProtocolInlineReferenceAliasAttachMutation,
  InlineReferenceAliasDetachMutation as ProtocolInlineReferenceAliasDetachMutation,
  InlineReferenceCreateMutation as ProtocolInlineReferenceCreateMutation,
} from "@lode/protocol/dto/edit";
import type {
  SupertagFieldConfig,
  JsonValue,
  NodeSeed,
  NodeType,
  ViewType,
  FieldDatatype,
  FieldCardinality,
  FieldInitializationExpression,
  PreviousValue,
  ProtocolDto,
  SequenceAnchor,
  TextAtomId,
} from "./model.js";
import type { FieldInitializationSource } from "./protocol-enums/model.js";

type WithKind<Value, Kind extends string> = Omit<ProtocolDto<Value>, "kind"> & Readonly<{ kind: Kind }>;

type NodeCreateMutation = Omit<WithKind<ProtocolContributionNodeCreateMutation, "node-create">, "seed"> &
  Readonly<{ seed?: NodeSeed }>;
type NodeOwnerSetMutation = Omit<WithKind<ProtocolNodeOwnerSetMutation, "node-owner-set">, "previousOwnerNodeId"> &
  Readonly<{ previousOwnerNodeId?: string }>;
type SupertagFieldConfigureMutation = Omit<
  WithKind<ProtocolContributionSupertagFieldConfigureMutation, "supertag-field-configure">,
  "config" | "previousConfig" | "observedConfigFactIds"
> &
  Readonly<{
    config: SupertagFieldConfig;
    previousConfig?: SupertagFieldConfig | null;
    observedConfigFactIds?: readonly string[];
  }>;

export type InitializedFieldValue =
  WithKind<ProtocolInitializedTextFieldValue, "text"> | WithKind<ProtocolInitializedReferenceFieldValue, "reference">;

type FieldInitializeMutation = Omit<
  WithKind<ProtocolFieldInitializeMutation, "field-initialize">,
  "source" | "values" | "observedInitializationFactIds"
> &
  Readonly<{
    source: FieldInitializationSource;
    values: readonly InitializedFieldValue[];
    observedInitializationFactIds?: readonly string[];
  }>;
type TextSpliceMutation = Omit<
  WithKind<ProtocolContributionTextSpliceMutation, "text-splice">,
  "deleteAtomIds" | "deletedAtoms" | "anchor" | "attributes"
> &
  Readonly<{
    deleteAtomIds: readonly TextAtomId[];
    deletedAtoms?: readonly Readonly<{
      id: TextAtomId;
      value: string;
      attributes: Readonly<Record<string, JsonValue>>;
    }>[];
    anchor: SequenceAnchor;
    attributes?: Readonly<Record<string, JsonValue>>;
  }>;
type TextMarkMutation = Omit<
  WithKind<ProtocolContributionTextMarkMutation, "text-mark">,
  "atomIds" | "value" | "previous"
> &
  Readonly<{ atomIds: readonly TextAtomId[]; value: PreviousValue; previous?: PreviousValue }>;
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
type InlineReferenceCreateMutation = Omit<
  WithKind<ProtocolInlineReferenceCreateMutation, "inline-reference-create">,
  "anchor"
> &
  Readonly<{ anchor: SequenceAnchor }>;
type InlineReferenceDeleteMutation = Omit<
  WithKind<ProtocolContributionInlineReferenceDeleteMutation, "inline-reference-delete">,
  "previousAnchor"
> &
  Readonly<{ previousAnchor?: SequenceAnchor }>;
type FieldDatatypeConfigureMutation = Omit<
  WithKind<ProtocolContributionFieldDatatypeConfigureMutation, "field-datatype-configure">,
  "datatype" | "previousDatatype" | "observedValueFactIds"
> &
  Readonly<{
    datatype: FieldDatatype;
    previousDatatype?: FieldDatatype | null;
    observedValueFactIds?: readonly string[];
  }>;
type FieldCardinalityConfigureMutation = Omit<
  WithKind<ProtocolContributionFieldCardinalityConfigureMutation, "field-cardinality-configure">,
  "cardinality" | "previousCardinality" | "observedValueFactIds"
> &
  Readonly<{
    cardinality: FieldCardinality;
    previousCardinality?: FieldCardinality | null;
    observedValueFactIds?: readonly string[];
  }>;
type FieldInitializationExpressionConfigureMutation = Omit<
  WithKind<
    ProtocolContributionFieldInitializationExpressionConfigureMutation,
    "field-initialization-expression-configure"
  >,
  "expression" | "previousExpression" | "observedValueFactIds"
> &
  Readonly<{
    expression: FieldInitializationExpression;
    previousExpression?: FieldInitializationExpression | null;
    observedValueFactIds?: readonly string[];
  }>;

export type ContributionMutation =
  | NodeCreateMutation
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
  | NodeOwnerSetMutation
  | WithKind<ProtocolMetanodeAttachMutation, "metanode-attach">
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
  | FieldInitializeMutation
  | TextSpliceMutation
  | TextMarkMutation
  | InlineReferenceCreateMutation
  | InlineReferenceDeleteMutation
  | WithKind<ProtocolInlineReferenceAliasAttachMutation, "inline-reference-alias-attach">
  | WithKind<ProtocolInlineReferenceAliasDetachMutation, "inline-reference-alias-detach">
  | WithKind<ProtocolSearchSupertagClauseAttachMutation, "search-supertag-clause-attach">
  | WithKind<ProtocolSearchFieldClauseAttachMutation, "search-field-clause-attach">
  | WithKind<ProtocolSharedDefaultViewDefinitionAttachMutation, "shared-default-view-definition-attach">
  | (Omit<
      WithKind<ProtocolSharedDefaultViewDefinitionModeSetMutation, "shared-default-view-definition-mode-set">,
      "viewType" | "previousViewType" | "observedModeFactIds"
    > &
      Readonly<{ viewType: ViewType; previousViewType?: ViewType | null; observedModeFactIds?: readonly string[] }>)
  | FieldDatatypeConfigureMutation
  | FieldCardinalityConfigureMutation
  | FieldInitializationExpressionConfigureMutation;

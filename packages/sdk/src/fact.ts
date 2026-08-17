import type {
  FieldMaterializeMutation as ProtocolFieldMaterializeMutation,
  FieldValueDeleteMutation as ProtocolFieldValueDeleteMutation,
  MaterializedFieldDeleteMutation as ProtocolMaterializedFieldDeleteMutation,
  NodeDeleteMutation as ProtocolNodeDeleteMutation,
  DeclareIntrinsicNodeTypeMutation as ProtocolDeclareIntrinsicNodeTypeMutation,
  OccurrenceCreateMutation as ProtocolOccurrenceCreateMutation,
  OccurrenceDeleteMutation as ProtocolOccurrenceDeleteMutation,
  OccurrenceMoveMutation as ProtocolOccurrenceMoveMutation,
  OccurrenceRestoreMutation as ProtocolOccurrenceRestoreMutation,
  SupertagApplyMutation as ProtocolSupertagApplyMutation,
  SupertagExtensionAddMutation as ProtocolSupertagExtensionAddMutation,
  SupertagExtensionRemoveMutation as ProtocolSupertagExtensionRemoveMutation,
  SupertagRemoveMutation as ProtocolSupertagRemoveMutation,
  SupertagTemplateNodeAddMutation as ProtocolSupertagTemplateNodeAddMutation,
  SupertagTemplateNodeRemoveMutation as ProtocolSupertagTemplateNodeRemoveMutation,
  SupertagTemplateFieldAttachMutation as ProtocolSupertagTemplateFieldAttachMutation,
  SupertagTemplateFieldExistingAttachMutation as ProtocolSupertagTemplateFieldExistingAttachMutation,
  SupertagTemplateFieldDetachMutation as ProtocolSupertagTemplateFieldDetachMutation,
  SupertagTemplateFieldDiscoverabilitySetMutation as ProtocolSupertagTemplateFieldDiscoverabilitySetMutation,
  SupertagOptionalFieldContributionAttachMutation as ProtocolSupertagOptionalFieldContributionAttachMutation,
  SupertagOptionalFieldContributionDetachMutation as ProtocolSupertagOptionalFieldContributionDetachMutation,
  TemplateNodeDetachMutation as ProtocolTemplateNodeDetachMutation,
  SearchExpressionAttachMutation as ProtocolSearchExpressionAttachMutation,
  SharedDefaultViewDefinitionAttachMutation as ProtocolSharedDefaultViewDefinitionAttachMutation,
  SharedDefaultViewDefinitionDetachMutation as ProtocolSharedDefaultViewDefinitionDetachMutation,
  SharedDefaultViewDefinitionModeSetMutation as ProtocolSharedDefaultViewDefinitionModeSetMutation,
  SharedDefaultViewDefinitionSortByNameSetMutation as ProtocolSharedDefaultViewDefinitionSortByNameSetMutation,
} from "@lode/protocol/dto/edit";
import type {
  ContributionNodeCreateMutation as ProtocolContributionNodeCreateMutation,
  ContributionNodeRestoreMutation as ProtocolNodeRestoreMutation,
  ContributionTextMarkMutation as ProtocolContributionTextMarkMutation,
  ContributionTextSpliceMutation as ProtocolContributionTextSpliceMutation,
  NodeOwnerSetMutation as ProtocolNodeOwnerSetMutation,
  MetanodeAttachMutation as ProtocolMetanodeAttachMutation,
  ContributionInlineReferenceDeleteMutation as ProtocolContributionInlineReferenceDeleteMutation,
  ContributionFieldDatatypeConfigureMutation as ProtocolContributionFieldDatatypeConfigureMutation,
  ContributionFieldCardinalityConfigureMutation as ProtocolContributionFieldCardinalityConfigureMutation,
  ContributionFieldOptionalityConfigureMutation as ProtocolContributionFieldOptionalityConfigureMutation,
  ContributionFieldInitializationExpressionConfigureMutation as ProtocolContributionFieldInitializationExpressionConfigureMutation,
  SearchExpressionDetachMutation as ProtocolSearchExpressionDetachMutation,
  SupertagTemplateFieldVisibilityConfigureMutation as ProtocolSupertagTemplateFieldVisibilityConfigureMutation,
  SharedDefaultViewDefinitionOptionsSetMutation as ProtocolSharedDefaultViewDefinitionOptionsSetMutation,
} from "@lode/protocol/dto/fact";
import type {
  InlineReferenceAliasAttachMutation as ProtocolInlineReferenceAliasAttachMutation,
  InlineReferenceAliasDetachMutation as ProtocolInlineReferenceAliasDetachMutation,
  InlineReferenceCreateMutation as ProtocolInlineReferenceCreateMutation,
} from "@lode/protocol/dto/edit";
import type {
  JsonValue,
  NodeSeed,
  IntrinsicNodeType,
  ViewType,
  FieldInitializationExpression,
  PreviousValue,
  ProtocolDto,
  SequenceAnchor,
  TextAtomId,
  TemplateFieldVisibility,
  SearchExpressionSpec,
  ViewOptionsSpec,
} from "./model.js";

type WithKind<Value, Kind extends string> = Omit<ProtocolDto<Value>, "kind"> & Readonly<{ kind: Kind }>;

type NodeCreateMutation = Omit<WithKind<ProtocolContributionNodeCreateMutation, "node-create">, "seed"> &
  Readonly<{ seed?: NodeSeed }>;
type NodeOwnerSetMutation = Omit<
  WithKind<ProtocolNodeOwnerSetMutation, "node-owner-set">,
  "ownerNodeId" | "previousOwnerNodeId"
> &
  Readonly<{ ownerNodeId: string | null; previousOwnerNodeId?: string | null }>;
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
  "previousDatatypeNodeId" | "observedValueFactIds"
> &
  Readonly<{
    previousDatatypeNodeId?: string | null;
    observedValueFactIds?: readonly string[];
  }>;
type FieldCardinalityConfigureMutation = Omit<
  WithKind<ProtocolContributionFieldCardinalityConfigureMutation, "field-cardinality-configure">,
  "previousCardinalityNodeId" | "observedValueFactIds"
> &
  Readonly<{
    previousCardinalityNodeId?: string | null;
    observedValueFactIds?: readonly string[];
  }>;
type FieldOptionalityConfigureMutation = Omit<
  WithKind<ProtocolContributionFieldOptionalityConfigureMutation, "field-optionality-configure">,
  "previousOptionalityNodeId" | "observedValueFactIds"
> &
  Readonly<{
    previousOptionalityNodeId?: string | null;
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
type SearchExpressionAttachMutation = Omit<
  WithKind<ProtocolSearchExpressionAttachMutation, "search-expression-attach">,
  "expression" | "previousExpression"
> &
  Readonly<{
    expression: SearchExpressionSpec;
    previousExpression?: SearchExpressionSpec;
  }>;
type SearchExpressionDetachMutation = Omit<
  WithKind<ProtocolSearchExpressionDetachMutation, "search-expression-detach">,
  "expression"
> &
  Readonly<{ expression: SearchExpressionSpec }>;

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
  | (Omit<WithKind<ProtocolDeclareIntrinsicNodeTypeMutation, "intrinsic-node-type-declare">, "intrinsicNodeType"> &
      Readonly<{ intrinsicNodeType: IntrinsicNodeType }>)
  | (Omit<WithKind<ProtocolSupertagApplyMutation, "supertag-apply">, "anchor"> & Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSupertagRemoveMutation, "supertag-remove">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSupertagExtensionAddMutation, "supertag-extension-add">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSupertagExtensionRemoveMutation, "supertag-extension-remove">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSupertagTemplateNodeAddMutation, "supertag-template-node-add">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSupertagTemplateNodeRemoveMutation, "supertag-template-node-remove">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSupertagTemplateFieldAttachMutation, "supertag-template-field-attach">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<
      WithKind<ProtocolSupertagTemplateFieldExistingAttachMutation, "supertag-template-field-existing-attach">,
      "anchor"
    > &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolSupertagTemplateFieldDetachMutation, "supertag-template-field-detach">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | (Omit<
      WithKind<ProtocolSupertagTemplateFieldDiscoverabilitySetMutation, "supertag-template-field-discoverability-set">,
      "previousDiscoverable"
    > &
      Readonly<{ previousDiscoverable?: boolean }>)
  | (Omit<
      WithKind<
        ProtocolSupertagTemplateFieldVisibilityConfigureMutation,
        "supertag-template-field-visibility-configure"
      >,
      "visibility" | "previousVisibility" | "observedVisibilityFactIds"
    > &
      Readonly<{
        visibility: TemplateFieldVisibility;
        previousVisibility?: TemplateFieldVisibility;
        observedVisibilityFactIds?: readonly string[];
      }>)
  | (Omit<
      WithKind<ProtocolSupertagOptionalFieldContributionAttachMutation, "supertag-optional-field-contribution-attach">,
      "anchor"
    > &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<
      WithKind<ProtocolSupertagOptionalFieldContributionDetachMutation, "supertag-optional-field-contribution-detach">,
      "previousAnchor"
    > &
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
  | InlineReferenceDeleteMutation
  | WithKind<ProtocolInlineReferenceAliasAttachMutation, "inline-reference-alias-attach">
  | WithKind<ProtocolInlineReferenceAliasDetachMutation, "inline-reference-alias-detach">
  | SearchExpressionAttachMutation
  | SearchExpressionDetachMutation
  | WithKind<ProtocolSharedDefaultViewDefinitionAttachMutation, "shared-default-view-definition-attach">
  | WithKind<ProtocolSharedDefaultViewDefinitionDetachMutation, "shared-default-view-definition-detach">
  | (Omit<
      WithKind<ProtocolSharedDefaultViewDefinitionModeSetMutation, "shared-default-view-definition-mode-set">,
      "viewType" | "previousViewType" | "observedModeFactIds"
    > &
      Readonly<{ viewType: ViewType; previousViewType?: ViewType | null; observedModeFactIds?: readonly string[] }>)
  | WithKind<
      ProtocolSharedDefaultViewDefinitionSortByNameSetMutation,
      "shared-default-view-definition-sort-by-name-set"
    >
  | (Omit<
      WithKind<ProtocolSharedDefaultViewDefinitionOptionsSetMutation, "shared-default-view-definition-options-set">,
      "options" | "previousOptions" | "observedOptionsFactIds"
    > &
      Readonly<{
        options: ViewOptionsSpec;
        previousOptions?: ViewOptionsSpec;
        observedOptionsFactIds?: readonly string[];
      }>)
  | FieldDatatypeConfigureMutation
  | FieldCardinalityConfigureMutation
  | FieldOptionalityConfigureMutation
  | FieldInitializationExpressionConfigureMutation;

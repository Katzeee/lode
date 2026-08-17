import type {
  FieldMaterializeMutation as ProtocolFieldMaterializeMutation,
  FieldValueDeleteMutation as ProtocolFieldValueDeleteMutation,
  MaterializedFieldDeleteMutation as ProtocolMaterializedFieldDeleteMutation,
  NodeCreateMutation as ProtocolNodeCreateMutation,
  NodeDeleteMutation as ProtocolNodeDeleteMutation,
  NodeRestoreMutation as ProtocolNodeRestoreMutation,
  DeclareIntrinsicNodeTypeMutation as ProtocolDeclareIntrinsicNodeTypeMutation,
  OccurrenceCreateMutation as ProtocolOccurrenceCreateMutation,
  OccurrenceDeleteMutation as ProtocolOccurrenceDeleteMutation,
  OccurrenceMoveMutation as ProtocolOccurrenceMoveMutation,
  OccurrenceRestoreMutation as ProtocolOccurrenceRestoreMutation,
  ReferencePromoteMutation as ProtocolReferencePromoteMutation,
  SupertagApplicationCreateMutation as ProtocolSupertagApplicationCreateMutation,
  SupertagExtensionAddMutation as ProtocolSupertagExtensionAddMutation,
  SupertagExtensionRemoveMutation as ProtocolSupertagExtensionRemoveMutation,
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
  SearchExpressionCreateMutation as ProtocolSearchExpressionCreateMutation,
  SearchExpressionUpdateMutation as ProtocolSearchExpressionUpdateMutation,
  SharedDefaultViewDefinitionCreateMutation as ProtocolSharedDefaultViewDefinitionCreateMutation,
  SharedDefaultViewDefinitionRemoveMutation as ProtocolSharedDefaultViewDefinitionRemoveMutation,
  SharedDefaultViewDefinitionModeSetMutation as ProtocolSharedDefaultViewDefinitionModeSetMutation,
  SharedDefaultViewDefinitionOptionsUpdateMutation as ProtocolSharedDefaultViewDefinitionOptionsUpdateMutation,
  FieldDatatypeConfigureMutation as ProtocolFieldDatatypeConfigureMutation,
  FieldCardinalityConfigureMutation as ProtocolFieldCardinalityConfigureMutation,
  FieldOptionalityConfigureMutation as ProtocolFieldOptionalityConfigureMutation,
  FieldDatatypeConfigurationCreateMutation as ProtocolFieldDatatypeConfigurationCreateMutation,
  FieldCardinalityConfigurationCreateMutation as ProtocolFieldCardinalityConfigurationCreateMutation,
  FieldOptionalityConfigurationCreateMutation as ProtocolFieldOptionalityConfigurationCreateMutation,
  FieldInitializationExpressionConfigurationCreateMutation as ProtocolFieldInitializationExpressionConfigurationCreateMutation,
  DebugNodeOpenMutation as ProtocolDebugNodeOpenMutation,
  FieldValueCreateMutation as ProtocolFieldValueCreateMutation,
  UrlNodeCreateMutation as ProtocolUrlNodeCreateMutation,
  CodeNodeConfigureMutation as ProtocolCodeNodeConfigureMutation,
  SharedDefaultViewDefinitionSortByNameCreateMutation as ProtocolSharedDefaultViewDefinitionSortByNameCreateMutation,
  SupertagTemplateFieldCreateMutation as ProtocolSupertagTemplateFieldCreateMutation,
  SupertagTemplateFieldAddExistingMutation as ProtocolSupertagTemplateFieldAddExistingMutation,
  SupertagTemplateFieldMakeDiscoverableMutation as ProtocolSupertagTemplateFieldMakeDiscoverableMutation,
  SupertagTemplateFieldRemoveMutation as ProtocolSupertagTemplateFieldRemoveMutation,
  SupertagOptionalFieldContributionAddMutation as ProtocolSupertagOptionalFieldContributionAddMutation,
  SupertagTemplateFieldVisibilitySetMutation as ProtocolSupertagTemplateFieldVisibilitySetMutation,
  SupertagTemplateFieldStaticDefaultSetMutation as ProtocolSupertagTemplateFieldStaticDefaultSetMutation,
  FieldNumberValueSetMutation as ProtocolFieldNumberValueSetMutation,
  FieldDateValueSetMutation as ProtocolFieldDateValueSetMutation,
  FieldCheckboxValueSetMutation as ProtocolFieldCheckboxValueSetMutation,
  FieldOptionsFromSupertagValueSetMutation as ProtocolFieldOptionsFromSupertagValueSetMutation,
  TypedFieldValueClearMutation as ProtocolTypedFieldValueClearMutation,
} from "@lode/protocol/dto/edit";
import type {
  JsonValue,
  NodeSeed,
  IntrinsicNodeType,
  PreviousValue,
  ProtocolDto,
  SequenceAnchor,
  TextAtomId,
  ViewType,
  FieldInitializationExpression,
  SearchExpressionSpec,
  ViewOptionsSpec,
  TemplateFieldVisibility,
} from "./model.js";

type WithKind<Value, Kind extends string> = Omit<ProtocolDto<Value>, "kind"> & Readonly<{ kind: Kind }>;

type NodeCreateMutation = Omit<
  WithKind<ProtocolNodeCreateMutation, "node-create">,
  "anchor" | "seed" | "intrinsicNodeType"
> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed; intrinsicNodeType?: IntrinsicNodeType }>;
type NodeRestoreMutation = Omit<WithKind<ProtocolNodeRestoreMutation, "node-restore">, "anchor"> &
  Readonly<{ anchor: SequenceAnchor }>;
type SupertagApplicationCreateMutation = Omit<
  WithKind<ProtocolSupertagApplicationCreateMutation, "supertag-application-create">,
  "anchor" | "seed"
> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed }>;
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
type SearchExpressionCreateMutation = Omit<
  WithKind<ProtocolSearchExpressionCreateMutation, "search-expression-create">,
  "anchor" | "seed" | "expression"
> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed; expression: SearchExpressionSpec }>;
type SearchExpressionUpdateMutation = Omit<
  WithKind<ProtocolSearchExpressionUpdateMutation, "search-expression-update">,
  "expression"
> &
  Readonly<{ expression: SearchExpressionSpec }>;
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
type SharedDefaultViewDefinitionOptionsUpdateMutation = Omit<
  WithKind<ProtocolSharedDefaultViewDefinitionOptionsUpdateMutation, "shared-default-view-definition-options-update">,
  "options"
> &
  Readonly<{ options: ViewOptionsSpec }>;
type SharedDefaultViewDefinitionRemoveMutation = WithKind<
  ProtocolSharedDefaultViewDefinitionRemoveMutation,
  "shared-default-view-definition-remove"
>;
type FieldDatatypeConfigureMutation = Omit<
  WithKind<ProtocolFieldDatatypeConfigureMutation, "field-datatype-configure">,
  "optionsSupertagId" | "optionsSupertagOccurrenceId"
> &
  Readonly<{ optionsSupertagId?: string; optionsSupertagOccurrenceId?: string }>;
type FieldCardinalityConfigureMutation = Omit<
  WithKind<ProtocolFieldCardinalityConfigureMutation, "field-cardinality-configure">,
  never
>;
type FieldOptionalityConfigureMutation = Omit<
  WithKind<ProtocolFieldOptionalityConfigureMutation, "field-optionality-configure">,
  never
>;
type FieldDatatypeConfigurationCreateMutation = Omit<
  WithKind<ProtocolFieldDatatypeConfigurationCreateMutation, "field-datatype-configuration-create">,
  "anchor" | "seed" | "optionsSupertagId" | "optionsSupertagOccurrenceId"
> &
  Readonly<{
    anchor: SequenceAnchor;
    seed?: NodeSeed;
    optionsSupertagId?: string;
    optionsSupertagOccurrenceId?: string;
  }>;
type FieldCardinalityConfigurationCreateMutation = Omit<
  WithKind<ProtocolFieldCardinalityConfigurationCreateMutation, "field-cardinality-configuration-create">,
  "anchor" | "seed"
> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed }>;
type FieldOptionalityConfigurationCreateMutation = Omit<
  WithKind<ProtocolFieldOptionalityConfigurationCreateMutation, "field-optionality-configuration-create">,
  "anchor" | "seed"
> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed }>;
type FieldInitializationExpressionConfigurationCreateMutation = Omit<
  WithKind<
    ProtocolFieldInitializationExpressionConfigurationCreateMutation,
    "field-initialization-expression-configuration-create"
  >,
  "expression" | "anchor" | "seed"
> &
  Readonly<{ expression: FieldInitializationExpression; anchor: SequenceAnchor; seed?: NodeSeed }>;

type FieldValueCreateMutation = Omit<
  WithKind<ProtocolFieldValueCreateMutation, "field-value-create">,
  "anchor" | "seed"
> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed }>;
type TypedFieldValueClearMutation = Omit<
  WithKind<ProtocolTypedFieldValueClearMutation, "typed-field-value-clear">,
  "emptyValueNodeId" | "emptyValueOccurrenceId"
> &
  Readonly<{ emptyValueNodeId?: string; emptyValueOccurrenceId?: string }>;
type UrlNodeCreateMutation = Omit<WithKind<ProtocolUrlNodeCreateMutation, "url-node-create">, "anchor" | "seed"> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed }>;
type SupertagTemplateFieldCreateMutation = Omit<
  WithKind<ProtocolSupertagTemplateFieldCreateMutation, "supertag-template-field-create">,
  "anchor" | "fieldDefinitionSeed"
> &
  Readonly<{ anchor: SequenceAnchor; fieldDefinitionSeed?: NodeSeed }>;
type SupertagTemplateFieldAddExistingMutation = Omit<
  WithKind<ProtocolSupertagTemplateFieldAddExistingMutation, "supertag-template-field-add-existing">,
  "anchor"
> &
  Readonly<{ anchor: SequenceAnchor }>;
type SupertagOptionalFieldContributionAddMutation = Omit<
  WithKind<ProtocolSupertagOptionalFieldContributionAddMutation, "supertag-optional-field-contribution-add">,
  "anchor"
> &
  Readonly<{ anchor: SequenceAnchor }>;

type SupertagTemplateFieldVisibilitySetMutation = Omit<
  WithKind<ProtocolSupertagTemplateFieldVisibilitySetMutation, "supertag-template-field-visibility-set">,
  "visibility"
> &
  Readonly<{ visibility: TemplateFieldVisibility }>;

export type EditMutation =
  | NodeCreateMutation
  | WithKind<ProtocolReferencePromoteMutation, "reference-promote">
  | WithKind<ProtocolNodeDeleteMutation, "node-delete">
  | NodeRestoreMutation
  | (Omit<WithKind<ProtocolOccurrenceCreateMutation, "occurrence-create">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolOccurrenceDeleteMutation, "occurrence-delete">, "previousAnchor"> &
      Readonly<{ previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolOccurrenceRestoreMutation, "occurrence-restore">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolOccurrenceMoveMutation, "occurrence-move">, "anchor" | "previousAnchor"> &
      Readonly<{ anchor: SequenceAnchor; previousAnchor?: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolDeclareIntrinsicNodeTypeMutation, "intrinsic-node-type-declare">, "intrinsicNodeType"> &
      Readonly<{ intrinsicNodeType: IntrinsicNodeType }>)
  | SupertagApplicationCreateMutation
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
  | SearchExpressionCreateMutation
  | SearchExpressionUpdateMutation
  | SharedDefaultViewDefinitionCreateMutation
  | SharedDefaultViewDefinitionRemoveMutation
  | SharedDefaultViewDefinitionModeSetMutation
  | SharedDefaultViewDefinitionOptionsUpdateMutation
  | FieldDatatypeConfigureMutation
  | FieldCardinalityConfigureMutation
  | FieldOptionalityConfigureMutation
  | FieldDatatypeConfigurationCreateMutation
  | FieldCardinalityConfigurationCreateMutation
  | FieldOptionalityConfigurationCreateMutation
  | FieldInitializationExpressionConfigurationCreateMutation
  | WithKind<ProtocolDebugNodeOpenMutation, "debug-node-open">
  | FieldValueCreateMutation
  | WithKind<ProtocolFieldNumberValueSetMutation, "field-number-value-set">
  | WithKind<ProtocolFieldDateValueSetMutation, "field-date-value-set">
  | WithKind<ProtocolFieldCheckboxValueSetMutation, "field-checkbox-value-set">
  | WithKind<ProtocolFieldOptionsFromSupertagValueSetMutation, "field-options-from-supertag-value-set">
  | TypedFieldValueClearMutation
  | UrlNodeCreateMutation
  | WithKind<ProtocolCodeNodeConfigureMutation, "code-node-configure">
  | WithKind<
      ProtocolSharedDefaultViewDefinitionSortByNameCreateMutation,
      "shared-default-view-definition-sort-by-name-create"
    >
  | SupertagTemplateFieldCreateMutation
  | SupertagTemplateFieldAddExistingMutation
  | WithKind<ProtocolSupertagTemplateFieldMakeDiscoverableMutation, "supertag-template-field-make-discoverable">
  | WithKind<ProtocolSupertagTemplateFieldRemoveMutation, "supertag-template-field-remove">
  | SupertagOptionalFieldContributionAddMutation
  | SupertagTemplateFieldVisibilitySetMutation
  | WithKind<ProtocolSupertagTemplateFieldStaticDefaultSetMutation, "supertag-template-field-static-default-set">;

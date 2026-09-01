import type {
  FieldMaterializeAction as ProtocolFieldMaterializeAction,
  FieldValueRemoveAction as ProtocolFieldValueRemoveAction,
  MaterializedFieldClearAction as ProtocolMaterializedFieldClearAction,
  NodeCreateAction as ProtocolNodeCreateAction,
  NodeDeleteAction as ProtocolNodeDeleteAction,
  NodeRestoreAction as ProtocolNodeRestoreAction,
  OccurrenceCreateAction as ProtocolOccurrenceCreateAction,
  OccurrenceDeleteAction as ProtocolOccurrenceDeleteAction,
  OccurrenceMoveAction as ProtocolOccurrenceMoveAction,
  OccurrenceRestoreAction as ProtocolOccurrenceRestoreAction,
  ReferencePromoteAction as ProtocolReferencePromoteAction,
  SupertagApplicationCreateAction as ProtocolSupertagApplicationCreateAction,
  SupertagExtensionAddAction as ProtocolSupertagExtensionAddAction,
  SupertagExtensionRemoveAction as ProtocolSupertagExtensionRemoveAction,
  SupertagRemoveAction as ProtocolSupertagRemoveAction,
  TemplateMemberAddAction as ProtocolTemplateMemberAddAction,
  TemplateMemberRemoveAction as ProtocolTemplateMemberRemoveAction,
  TemplateNodeDetachAction as ProtocolTemplateNodeDetachAction,
  RichTextMarkAction as ProtocolRichTextMarkAction,
  RichTextSpliceAction as ProtocolRichTextSpliceAction,
  InlineReferenceCreateAction as ProtocolInlineReferenceCreateAction,
  InlineReferenceRemoveAction as ProtocolInlineReferenceRemoveAction,
  InlineAliasAttachAction as ProtocolInlineAliasAttachAction,
  InlineAliasDetachAction as ProtocolInlineAliasDetachAction,
  InlineReferenceAliasCreateAction as ProtocolInlineReferenceAliasCreateAction,
  SearchExpressionCreateAction as ProtocolSearchExpressionCreateAction,
  SearchExpressionAddAction as ProtocolSearchExpressionAddAction,
  SearchExpressionConfigureAction as ProtocolSearchExpressionConfigureAction,
  SearchExpressionMoveAction as ProtocolSearchExpressionMoveAction,
  SearchExpressionRemoveAction as ProtocolSearchExpressionRemoveAction,
  SharedDefaultViewCreateAction as ProtocolSharedDefaultViewCreateAction,
  SharedDefaultViewRemoveAction as ProtocolSharedDefaultViewRemoveAction,
  ViewModeSetAction as ProtocolViewModeSetAction,
  ViewColumnAddAction as ProtocolViewColumnAddAction,
  ViewColumnRemoveAction as ProtocolViewColumnRemoveAction,
  ViewColumnMoveAction as ProtocolViewColumnMoveAction,
  ViewSortAddAction as ProtocolViewSortAddAction,
  ViewSortConfigureAction as ProtocolViewSortConfigureAction,
  ViewSortRemoveAction as ProtocolViewSortRemoveAction,
  ViewSortByNodeNameAction as ProtocolViewSortByNodeNameAction,
  ViewGroupAddAction as ProtocolViewGroupAddAction,
  ViewGroupRemoveAction as ProtocolViewGroupRemoveAction,
  ViewFilterCreateAction as ProtocolViewFilterCreateAction,
  ViewFilterRemoveAction as ProtocolViewFilterRemoveAction,
  ViewFilterExpressionAddAction as ProtocolViewFilterExpressionAddAction,
  ViewFilterExpressionConfigureAction as ProtocolViewFilterExpressionConfigureAction,
  ViewFilterExpressionMoveAction as ProtocolViewFilterExpressionMoveAction,
  ViewFilterExpressionRemoveAction as ProtocolViewFilterExpressionRemoveAction,
  FieldDatatypeConfigureAction as ProtocolFieldDatatypeConfigureAction,
  FieldCardinalityConfigureAction as ProtocolFieldCardinalityConfigureAction,
  FieldOptionalityConfigureAction as ProtocolFieldOptionalityConfigureAction,
  FieldInitializationExpressionConfigureAction as ProtocolFieldInitializationExpressionConfigureAction,
  FieldValueCreateAction as ProtocolFieldValueCreateAction,
  UrlNodeCreateAction as ProtocolUrlNodeCreateAction,
  CodeNodeConfigureAction as ProtocolCodeNodeConfigureAction,
  SupertagTemplateFieldCreateAction as ProtocolSupertagTemplateFieldCreateAction,
  SupertagTemplateFieldAddExistingAction as ProtocolSupertagTemplateFieldAddExistingAction,
  SupertagTemplateFieldMakeDiscoverableAction as ProtocolSupertagTemplateFieldMakeDiscoverableAction,
  SupertagTemplateFieldRemoveAction as ProtocolSupertagTemplateFieldRemoveAction,
  SupertagOptionalFieldContributionAddAction as ProtocolSupertagOptionalFieldContributionAddAction,
  SupertagOptionalFieldContributionRemoveAction as ProtocolSupertagOptionalFieldContributionRemoveAction,
  SupertagTemplateFieldVisibilitySetAction as ProtocolSupertagTemplateFieldVisibilitySetAction,
  SupertagTemplateFieldStaticDefaultSetAction as ProtocolSupertagTemplateFieldStaticDefaultSetAction,
  FieldNumberValueSetAction as ProtocolFieldNumberValueSetAction,
  FieldDateValueSetAction as ProtocolFieldDateValueSetAction,
  FieldCheckboxValueSetAction as ProtocolFieldCheckboxValueSetAction,
  FieldOptionsFromSupertagValueSetAction as ProtocolFieldOptionsFromSupertagValueSetAction,
  TypedFieldValueClearAction as ProtocolTypedFieldValueClearAction,
} from "@lode/protocol/proto";
import type {
  JsonValue,
  NodeSeed,
  IntrinsicNodeType,
  PreviousValue,
  SequenceAnchor,
  TextAtomId,
  ViewType,
  FieldInitializationExpression,
  SearchExpressionDraft,
  SearchClause,
  ViewSortDirection,
  TemplateFieldVisibility,
} from "./model.js";
import type { WithKind } from "./protocol-dto.js";

type NodeCreateAction = Omit<
  WithKind<ProtocolNodeCreateAction, "node-create">,
  "anchor" | "seed" | "intrinsicNodeType"
> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed; intrinsicNodeType?: IntrinsicNodeType }>;
type NodeRestoreAction = Omit<WithKind<ProtocolNodeRestoreAction, "node-restore">, "anchor"> &
  Readonly<{ anchor: SequenceAnchor }>;
type SupertagApplicationCreateAction = Omit<
  WithKind<ProtocolSupertagApplicationCreateAction, "supertag-application-create">,
  "anchor"
> &
  Readonly<{ anchor: SequenceAnchor }>;
type TemplateNodeDetachAction = Omit<WithKind<ProtocolTemplateNodeDetachAction, "template-node-detach">, "anchor"> &
  Readonly<{ anchor: SequenceAnchor }>;
type RichTextSpliceAction = Omit<
  WithKind<ProtocolRichTextSpliceAction, "rich-text-splice">,
  "anchor" | "deleteAtomIds" | "attributes"
> &
  Readonly<{
    anchor: SequenceAnchor;
    deleteAtomIds: readonly TextAtomId[];
    attributes?: Readonly<Record<string, JsonValue>>;
  }>;
type RichTextMarkAction = Omit<WithKind<ProtocolRichTextMarkAction, "rich-text-mark">, "atomIds" | "value"> &
  Readonly<{ atomIds: readonly TextAtomId[]; value: PreviousValue }>;
type InlineReferenceCreateAction = Omit<
  WithKind<ProtocolInlineReferenceCreateAction, "inline-reference-create">,
  "anchor"
> &
  Readonly<{ anchor: SequenceAnchor }>;
type InlineReferenceAliasCreateAction = Omit<
  WithKind<ProtocolInlineReferenceAliasCreateAction, "inline-reference-alias-create">,
  "seed"
> &
  Readonly<{ seed?: NodeSeed }>;
type SearchExpressionCreateAction = Omit<
  WithKind<ProtocolSearchExpressionCreateAction, "search-expression-create">,
  "anchor" | "expression"
> &
  Readonly<{ anchor: SequenceAnchor; expression: SearchExpressionDraft }>;
type SearchExpressionAddAction = Omit<
  WithKind<ProtocolSearchExpressionAddAction, "search-expression-add">,
  "anchor" | "expression"
> &
  Readonly<{ anchor: SequenceAnchor; expression: SearchExpressionDraft }>;
type SearchExpressionConfigureAction = Omit<
  WithKind<ProtocolSearchExpressionConfigureAction, "search-expression-configure">,
  "clause"
> &
  Readonly<{ clause: SearchClause }>;
type SearchExpressionMoveAction = Omit<
  WithKind<ProtocolSearchExpressionMoveAction, "search-expression-move">,
  "anchor"
> &
  Readonly<{ anchor: SequenceAnchor }>;
type SearchExpressionRemoveAction = WithKind<ProtocolSearchExpressionRemoveAction, "search-expression-remove">;
type SharedDefaultViewCreateAction = Omit<
  WithKind<ProtocolSharedDefaultViewCreateAction, "shared-default-view-create">,
  "anchor" | "viewType"
> &
  Readonly<{ anchor: SequenceAnchor; viewType: ViewType }>;
type ViewModeSetAction = Omit<WithKind<ProtocolViewModeSetAction, "view-mode-set">, "viewType"> &
  Readonly<{ viewType: ViewType }>;
type SharedDefaultViewRemoveAction = WithKind<ProtocolSharedDefaultViewRemoveAction, "shared-default-view-remove">;
type ViewColumnAddAction = Omit<WithKind<ProtocolViewColumnAddAction, "view-column-add">, "anchor"> &
  Readonly<{ anchor: SequenceAnchor }>;
type ViewColumnMoveAction = Omit<WithKind<ProtocolViewColumnMoveAction, "view-column-move">, "anchor"> &
  Readonly<{ anchor: SequenceAnchor }>;
type ViewSortAddAction = Omit<WithKind<ProtocolViewSortAddAction, "view-sort-add">, "direction"> &
  Readonly<{ direction: ViewSortDirection }>;
type ViewSortConfigureAction = Omit<WithKind<ProtocolViewSortConfigureAction, "view-sort-configure">, "direction"> &
  Readonly<{ direction: ViewSortDirection }>;
type ViewSortByNodeNameAction = Omit<
  WithKind<ProtocolViewSortByNodeNameAction, "view-sort-by-node-name">,
  "direction"
> &
  Readonly<{ direction: ViewSortDirection }>;
type ViewFilterCreateAction = Omit<
  WithKind<ProtocolViewFilterCreateAction, "view-filter-create">,
  "anchor" | "expression"
> &
  Readonly<{ anchor: SequenceAnchor; expression: SearchExpressionDraft }>;
type ViewFilterExpressionAddAction = Omit<
  WithKind<ProtocolViewFilterExpressionAddAction, "view-filter-expression-add">,
  "anchor" | "expression"
> &
  Readonly<{ anchor: SequenceAnchor; expression: SearchExpressionDraft }>;
type ViewFilterExpressionConfigureAction = Omit<
  WithKind<ProtocolViewFilterExpressionConfigureAction, "view-filter-expression-configure">,
  "clause"
> &
  Readonly<{ clause: SearchClause }>;
type ViewFilterExpressionMoveAction = Omit<
  WithKind<ProtocolViewFilterExpressionMoveAction, "view-filter-expression-move">,
  "anchor"
> &
  Readonly<{ anchor: SequenceAnchor }>;
type FieldDatatypeConfigureAction = Omit<
  WithKind<ProtocolFieldDatatypeConfigureAction, "field-datatype-configure">,
  "optionsSupertagId"
> &
  Readonly<{ optionsSupertagId?: string }>;
type FieldCardinalityConfigureAction = WithKind<ProtocolFieldCardinalityConfigureAction, "field-cardinality-configure">;
type FieldOptionalityConfigureAction = WithKind<ProtocolFieldOptionalityConfigureAction, "field-optionality-configure">;
type FieldInitializationExpressionConfigureAction = Omit<
  WithKind<ProtocolFieldInitializationExpressionConfigureAction, "field-initialization-expression-configure">,
  "expression"
> &
  Readonly<{ expression: FieldInitializationExpression }>;

type FieldValueCreateAction = Omit<WithKind<ProtocolFieldValueCreateAction, "field-value-create">, "anchor" | "seed"> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed }>;
type TypedFieldValueClearAction = Omit<
  WithKind<ProtocolTypedFieldValueClearAction, "typed-field-value-clear">,
  "emptyValueNodeId" | "emptyValueOccurrenceId"
> &
  Readonly<{ emptyValueNodeId?: string; emptyValueOccurrenceId?: string }>;
type UrlNodeCreateAction = Omit<WithKind<ProtocolUrlNodeCreateAction, "url-node-create">, "anchor" | "seed"> &
  Readonly<{ anchor: SequenceAnchor; seed?: NodeSeed }>;
type SupertagTemplateFieldCreateAction = Omit<
  WithKind<ProtocolSupertagTemplateFieldCreateAction, "supertag-template-field-create">,
  "anchor" | "fieldDefinitionSeed"
> &
  Readonly<{ anchor: SequenceAnchor; fieldDefinitionSeed?: NodeSeed }>;
type SupertagTemplateFieldAddExistingAction = Omit<
  WithKind<ProtocolSupertagTemplateFieldAddExistingAction, "supertag-template-field-add-existing">,
  "anchor"
> &
  Readonly<{ anchor: SequenceAnchor }>;
type SupertagOptionalFieldContributionAddAction = Omit<
  WithKind<ProtocolSupertagOptionalFieldContributionAddAction, "supertag-optional-field-contribution-add">,
  "anchor"
> &
  Readonly<{ anchor: SequenceAnchor }>;

type SupertagTemplateFieldVisibilitySetAction = Omit<
  WithKind<ProtocolSupertagTemplateFieldVisibilitySetAction, "supertag-template-field-visibility-set">,
  "visibility"
> &
  Readonly<{ visibility: TemplateFieldVisibility }>;

export type EditAction =
  | NodeCreateAction
  | WithKind<ProtocolReferencePromoteAction, "reference-promote">
  | WithKind<ProtocolNodeDeleteAction, "node-delete">
  | NodeRestoreAction
  | (Omit<WithKind<ProtocolOccurrenceCreateAction, "occurrence-create">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | WithKind<ProtocolOccurrenceDeleteAction, "occurrence-delete">
  | (Omit<WithKind<ProtocolOccurrenceRestoreAction, "occurrence-restore">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | (Omit<WithKind<ProtocolOccurrenceMoveAction, "occurrence-move">, "anchor"> & Readonly<{ anchor: SequenceAnchor }>)
  | SupertagApplicationCreateAction
  | WithKind<ProtocolSupertagRemoveAction, "supertag-remove">
  | (Omit<WithKind<ProtocolSupertagExtensionAddAction, "supertag-extension-add">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | WithKind<ProtocolSupertagExtensionRemoveAction, "supertag-extension-remove">
  | (Omit<WithKind<ProtocolTemplateMemberAddAction, "template-member-add">, "anchor"> &
      Readonly<{ anchor: SequenceAnchor }>)
  | WithKind<ProtocolTemplateMemberRemoveAction, "template-member-remove">
  | TemplateNodeDetachAction
  | WithKind<ProtocolFieldMaterializeAction, "field-materialize">
  | WithKind<ProtocolFieldValueRemoveAction, "field-value-remove">
  | WithKind<ProtocolMaterializedFieldClearAction, "materialized-field-clear">
  | RichTextSpliceAction
  | RichTextMarkAction
  | InlineReferenceCreateAction
  | WithKind<ProtocolInlineReferenceRemoveAction, "inline-reference-remove">
  | WithKind<ProtocolInlineAliasAttachAction, "inline-alias-attach">
  | WithKind<ProtocolInlineAliasDetachAction, "inline-alias-detach">
  | InlineReferenceAliasCreateAction
  | SearchExpressionCreateAction
  | SearchExpressionAddAction
  | SearchExpressionConfigureAction
  | SearchExpressionMoveAction
  | SearchExpressionRemoveAction
  | SharedDefaultViewCreateAction
  | SharedDefaultViewRemoveAction
  | ViewModeSetAction
  | ViewColumnAddAction
  | WithKind<ProtocolViewColumnRemoveAction, "view-column-remove">
  | ViewColumnMoveAction
  | ViewSortAddAction
  | ViewSortConfigureAction
  | WithKind<ProtocolViewSortRemoveAction, "view-sort-remove">
  | ViewSortByNodeNameAction
  | WithKind<ProtocolViewGroupAddAction, "view-group-add">
  | WithKind<ProtocolViewGroupRemoveAction, "view-group-remove">
  | ViewFilterCreateAction
  | WithKind<ProtocolViewFilterRemoveAction, "view-filter-remove">
  | ViewFilterExpressionAddAction
  | ViewFilterExpressionConfigureAction
  | ViewFilterExpressionMoveAction
  | WithKind<ProtocolViewFilterExpressionRemoveAction, "view-filter-expression-remove">
  | FieldDatatypeConfigureAction
  | FieldCardinalityConfigureAction
  | FieldOptionalityConfigureAction
  | FieldInitializationExpressionConfigureAction
  | FieldValueCreateAction
  | WithKind<ProtocolFieldNumberValueSetAction, "field-number-value-set">
  | WithKind<ProtocolFieldDateValueSetAction, "field-date-value-set">
  | WithKind<ProtocolFieldCheckboxValueSetAction, "field-checkbox-value-set">
  | WithKind<ProtocolFieldOptionsFromSupertagValueSetAction, "field-options-from-supertag-value-set">
  | TypedFieldValueClearAction
  | UrlNodeCreateAction
  | WithKind<ProtocolCodeNodeConfigureAction, "code-node-configure">
  | SupertagTemplateFieldCreateAction
  | SupertagTemplateFieldAddExistingAction
  | WithKind<ProtocolSupertagTemplateFieldMakeDiscoverableAction, "supertag-template-field-make-discoverable">
  | WithKind<ProtocolSupertagTemplateFieldRemoveAction, "supertag-template-field-remove">
  | SupertagOptionalFieldContributionAddAction
  | WithKind<ProtocolSupertagOptionalFieldContributionRemoveAction, "supertag-optional-field-contribution-remove">
  | SupertagTemplateFieldVisibilitySetAction
  | WithKind<ProtocolSupertagTemplateFieldStaticDefaultSetAction, "supertag-template-field-static-default-set">;

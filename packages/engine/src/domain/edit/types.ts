import {
  isGraphAction,
  type AuthoredAction,
  type GraphAction,
  type IntrinsicNodeType,
  type NodeSeed,
  type SequenceAnchor,
} from "../fact/index.js";
import type { CodeNodeConfigureEdit, FieldValueCreateEdit, UrlNodeCreateEdit } from "./breadth-edit-types.js";
import type {
  AddExistingSupertagTemplateFieldEdit,
  AddSupertagOptionalFieldContributionEdit,
  RemoveSupertagOptionalFieldContributionEdit,
  CreateSupertagTemplateFieldEdit,
  MakeSupertagTemplateFieldDiscoverableEdit,
  RemoveSupertagTemplateFieldEdit,
  SetSupertagTemplateFieldStaticDefaultEdit,
  SetSupertagTemplateFieldVisibilityEdit,
} from "./template-field-edit-types.js";
import type { ConfigureFieldDefinitionEdit } from "./field-definition-configuration-edit-types.js";
import type { TypedFieldValueEdit } from "./typed-field-value-edit-types.js";
import type {
  AddSearchExpressionEdit,
  ConfigureSearchExpressionEdit,
  CreateSearchExpressionEdit,
  CreateSharedDefaultViewDefinitionEdit,
  MoveSearchExpressionEdit,
  RemoveSearchExpressionEdit,
  RemoveSharedDefaultViewDefinitionEdit,
  ViewColumnEdit,
  ViewFilterEdit,
  ViewGroupEdit,
  ViewModeEdit,
  ViewSortEdit,
} from "./search-view-edit-types.js";
export type { ConfigureFieldDefinitionEdit } from "./field-definition-configuration-edit-types.js";

const ACTION_EDIT_ACCESS = {
  "workspace-bootstrap": "internal",
  "node-create": "composite",
  "node-trash": "internal",
  "node-restore": "composite",
  "original-promote": "internal",
  "placement-create": "internal",
  "placement-remove": "internal",
  "placement-move": "internal",
  "supertag-application-add": "internal",
  "supertag-membership-remove": "internal",
  "supertag-extension-add": "direct",
  "supertag-extension-remove": "direct",
  "template-member-add": "direct",
  "template-member-remove": "direct",
  "template-field-add": "internal",
  "template-field-remove": "internal",
  "template-field-restore": "internal",
  "template-field-visibility-set": "internal",
  "template-field-static-default-set": "internal",
  "optional-field-contribution-add": "internal",
  "optional-field-contribution-remove": "internal",
  "template-node-detach": "direct",
  "field-materialize": "direct",
  "field-value-remove": "direct",
  "materialized-field-clear": "direct",
  "field-configuration-set": "internal",
  "field-definition-make-discoverable": "internal",
  "field-definition-return-to-template-field": "internal",
  "rich-text-splice": "direct",
  "rich-text-mark": "direct",
  "inline-reference-create": "direct",
  "inline-reference-remove": "direct",
  "inline-alias-attach": "direct",
  "inline-alias-detach": "direct",
  "search-expression-add": "internal",
  "search-expression-configure": "internal",
  "search-expression-move": "internal",
  "search-expression-remove": "internal",
  "search-expression-restore": "internal",
  "shared-default-view-add": "internal",
  "shared-default-view-remove": "composite",
  "shared-default-view-restore": "internal",
  "view-mode-set": "internal",
  "view-column-add": "internal",
  "view-column-remove": "internal",
  "view-column-move": "internal",
  "view-sort-add": "internal",
  "view-sort-configure": "internal",
  "view-sort-remove": "internal",
  "view-sort-restore": "internal",
  "view-group-add": "internal",
  "view-group-remove": "internal",
  "view-filter-add": "internal",
  "view-filter-remove": "internal",
  "view-filter-restore": "internal",
} as const satisfies Readonly<Record<GraphAction["kind"], "direct" | "composite" | "internal">>;

type CreateNodeEdit = Readonly<{
  kind: "node-create";
  nodeId: string;
  occurrenceId: string;
  parentNodeId: string;
  anchor: SequenceAnchor;
  seed?: NodeSeed;
  intrinsicNodeType?: IntrinsicNodeType;
}>;

type DeleteNodeEdit = Readonly<{
  kind: "node-delete";
  nodeId: string;
}>;

type RestoreNodeEdit = Readonly<{
  kind: "node-restore";
  nodeId: string;
  occurrenceId: string;
  parentNodeId: string;
  anchor: SequenceAnchor;
}>;

type PromoteReferenceEdit = Readonly<{
  kind: "reference-promote";
  occurrenceId: string;
}>;

type OccurrenceEdit =
  | Readonly<{
      kind: "occurrence-create";
      occurrenceId: string;
      nodeId: string;
      parentNodeId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{ kind: "occurrence-delete"; occurrenceId: string }>
  | Readonly<{
      kind: "occurrence-restore";
      occurrenceId: string;
      nodeId: string;
      parentNodeId: string;
      anchor: SequenceAnchor;
    }>
  | Readonly<{
      kind: "occurrence-move";
      occurrenceId: string;
      parentNodeId: string;
      anchor: SequenceAnchor;
    }>;

type CreateSupertagApplicationEdit = Readonly<{
  kind: "supertag-application-create";
  hostNodeId: string;
  supertagId: string;
  anchor: SequenceAnchor;
}>;

type RemoveSupertagApplicationEdit = Readonly<{
  kind: "supertag-remove";
  hostNodeId: string;
  supertagId: string;
}>;

type CreateInlineReferenceAliasEdit = Readonly<{
  kind: "inline-reference-alias-create";
  inlineReferenceId: string;
  hostNodeId: string;
  aliasNodeId: string;
  seed?: NodeSeed;
}>;

type DirectEditActionKind = {
  [Kind in GraphAction["kind"]]: (typeof ACTION_EDIT_ACCESS)[Kind] extends "direct" ? Kind : never;
}[GraphAction["kind"]];

type DirectAuthoredActionEdit = Extract<GraphAction, { kind: DirectEditActionKind }>;

export type EditAction =
  | DirectAuthoredActionEdit
  | CreateNodeEdit
  | DeleteNodeEdit
  | RestoreNodeEdit
  | CreateSupertagApplicationEdit
  | RemoveSupertagApplicationEdit
  | CreateSupertagTemplateFieldEdit
  | AddExistingSupertagTemplateFieldEdit
  | MakeSupertagTemplateFieldDiscoverableEdit
  | RemoveSupertagTemplateFieldEdit
  | SetSupertagTemplateFieldStaticDefaultEdit
  | SetSupertagTemplateFieldVisibilityEdit
  | AddSupertagOptionalFieldContributionEdit
  | RemoveSupertagOptionalFieldContributionEdit
  | PromoteReferenceEdit
  | OccurrenceEdit
  | CreateInlineReferenceAliasEdit
  | CreateSearchExpressionEdit
  | AddSearchExpressionEdit
  | ConfigureSearchExpressionEdit
  | MoveSearchExpressionEdit
  | RemoveSearchExpressionEdit
  | CreateSharedDefaultViewDefinitionEdit
  | RemoveSharedDefaultViewDefinitionEdit
  | ViewModeEdit
  | ViewColumnEdit
  | ViewSortEdit
  | ViewGroupEdit
  | ViewFilterEdit
  | ConfigureFieldDefinitionEdit
  | FieldValueCreateEdit
  | UrlNodeCreateEdit
  | CodeNodeConfigureEdit
  | TypedFieldValueEdit;
type ExpandableEdit = Exclude<
  EditAction,
  | PromoteReferenceEdit
  | OccurrenceEdit
  | DeleteNodeEdit
  | RestoreNodeEdit
  | CreateSupertagApplicationEdit
  | RemoveSupertagApplicationEdit
  | CreateSupertagTemplateFieldEdit
  | AddExistingSupertagTemplateFieldEdit
  | MakeSupertagTemplateFieldDiscoverableEdit
  | RemoveSupertagTemplateFieldEdit
  | SetSupertagTemplateFieldStaticDefaultEdit
  | SetSupertagTemplateFieldVisibilityEdit
  | AddSupertagOptionalFieldContributionEdit
  | RemoveSupertagOptionalFieldContributionEdit
  | CreateInlineReferenceAliasEdit
  | CreateSearchExpressionEdit
  | AddSearchExpressionEdit
  | ConfigureSearchExpressionEdit
  | MoveSearchExpressionEdit
  | RemoveSearchExpressionEdit
  | CreateSharedDefaultViewDefinitionEdit
  | RemoveSharedDefaultViewDefinitionEdit
  | ViewModeEdit
  | ViewColumnEdit
  | ViewSortEdit
  | ViewGroupEdit
  | ViewFilterEdit
  | ConfigureFieldDefinitionEdit
  | FieldValueCreateEdit
  | UrlNodeCreateEdit
  | CodeNodeConfigureEdit
  | TypedFieldValueEdit
>;

export function isDirectAuthoredActionEdit(action: AuthoredAction): action is DirectAuthoredActionEdit {
  return isGraphAction(action) && ACTION_EDIT_ACCESS[action.kind] === "direct";
}

export function expandEditAction(edit: ExpandableEdit): readonly [GraphAction, ...GraphAction[]] {
  if (edit.kind !== "node-create") {
    return [edit];
  }
  const { occurrenceId, parentNodeId, anchor, ...node } = edit;
  return [
    {
      ...node,
      ownerNodeId: parentNodeId,
      originalPlacement: { placementId: occurrenceId, anchor },
    },
  ];
}

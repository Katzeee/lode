import type { FieldContentRemovalAction } from "./field-content-types.js";
import type { FactAction, AuthoredAction } from "./types.js";

const ACTION_KINDS_BY_FAMILY = {
  node: ["workspace-bootstrap", "node-create", "node-trash", "node-restore", "original-promote"],
  placement: ["placement-create", "placement-remove", "placement-move"],
  supertag: [
    "supertag-application-add",
    "supertag-membership-remove",
    "supertag-extension-add",
    "supertag-extension-remove",
    "template-member-add",
    "template-member-remove",
    "template-field-add",
    "template-field-remove",
    "template-field-restore",
    "template-field-visibility-set",
    "template-field-static-default-set",
    "optional-field-contribution-add",
    "optional-field-contribution-remove",
  ],
  template: ["template-node-detach"],
  field: ["field-materialize", "field-value-remove", "materialized-field-clear"],
  fieldDefinition: [
    "field-configuration-set",
    "field-definition-make-discoverable",
    "field-definition-return-to-template-field",
  ],
  text: ["rich-text-splice", "rich-text-mark"],
  inlineReference: ["inline-reference-create", "inline-reference-remove", "inline-alias-attach", "inline-alias-detach"],
  search: [
    "search-expression-add",
    "search-expression-configure",
    "search-expression-move",
    "search-expression-remove",
    "search-expression-restore",
  ],
  view: [
    "shared-default-view-add",
    "shared-default-view-remove",
    "shared-default-view-restore",
    "view-mode-set",
    "view-column-add",
    "view-column-remove",
    "view-column-move",
    "view-sort-add",
    "view-sort-configure",
    "view-sort-remove",
    "view-sort-restore",
    "view-group-add",
    "view-group-remove",
    "view-filter-add",
    "view-filter-remove",
    "view-filter-restore",
  ],
} as const satisfies Readonly<Record<string, readonly AuthoredAction["kind"][]>>;

type ClassifiedActionKind = (typeof ACTION_KINDS_BY_FAMILY)[keyof typeof ACTION_KINDS_BY_FAMILY][number];
type AssertNever<Value extends never> = Value;
type ActionFamily =
  AssertNever<Exclude<AuthoredAction["kind"], ClassifiedActionKind>> extends never
    ? keyof typeof ACTION_KINDS_BY_FAMILY
    : never;

type ActionKindInFamily<Family extends ActionFamily> = {
  [Kind in AuthoredAction["kind"]]: Kind extends (typeof ACTION_KINDS_BY_FAMILY)[Family][number] ? Kind : never;
}[AuthoredAction["kind"]];

type ActionInFamily<Family extends ActionFamily> = Extract<AuthoredAction, { kind: ActionKindInFamily<Family> }>;

export type NodeAction = ActionInFamily<"node">;
export type PlacementAction = ActionInFamily<"placement">;
export type SupertagAction = ActionInFamily<"supertag">;
export type TemplateAction = ActionInFamily<"template">;
export type FieldAction = ActionInFamily<"field">;
export type FieldDefinitionAction = ActionInFamily<"fieldDefinition">;
type FieldDefinitionConfigAction = Extract<FieldDefinitionAction, { kind: "field-configuration-set" }>;
export type TextAction = ActionInFamily<"text">;
export type InlineReferenceAction = ActionInFamily<"inlineReference">;
export type SearchExpressionAction = ActionInFamily<"search">;
export type ViewAction = ActionInFamily<"view">;

export function isNodeAction(action: AuthoredAction): action is NodeAction {
  return actionBelongsTo(action, "node");
}

export function isPlacementAction(action: AuthoredAction): action is PlacementAction {
  return actionBelongsTo(action, "placement");
}

export function isSupertagAction(action: AuthoredAction): action is SupertagAction {
  return actionBelongsTo(action, "supertag");
}

export function isTemplateAction(action: AuthoredAction): action is TemplateAction {
  return actionBelongsTo(action, "template");
}

export function isFieldAction(action: AuthoredAction): action is FieldAction {
  return actionBelongsTo(action, "field");
}

export function isFieldDefinitionAction(action: AuthoredAction): action is FieldDefinitionAction {
  return actionBelongsTo(action, "fieldDefinition");
}

export function isFieldDefinitionConfigAction(action: AuthoredAction): action is FieldDefinitionConfigAction {
  return action.kind === "field-configuration-set";
}

export function isTextAction(action: AuthoredAction): action is TextAction {
  return actionBelongsTo(action, "text");
}

export function isInlineReferenceAction(action: AuthoredAction): action is InlineReferenceAction {
  return actionBelongsTo(action, "inlineReference");
}

export function isSearchAction(action: AuthoredAction): action is SearchExpressionAction {
  return actionBelongsTo(action, "search");
}

export function isViewAction(action: AuthoredAction): action is ViewAction {
  return actionBelongsTo(action, "view");
}

export type FactActionOf<Kind extends AuthoredAction["kind"]> = FactAction &
  Readonly<{ action: Extract<AuthoredAction, { kind: Kind }> }>;

export function factActionsOfKind<Kind extends AuthoredAction["kind"]>(
  facts: readonly FactAction[],
  kind: Kind,
): readonly FactActionOf<Kind>[] {
  return factActionsOfKinds(facts, [kind]);
}

export function factActionsOfKinds<Kind extends AuthoredAction["kind"]>(
  facts: readonly FactAction[],
  kinds: readonly Kind[],
): readonly FactActionOf<Kind>[] {
  return facts.filter((fact): fact is FactActionOf<Kind> =>
    (kinds as readonly AuthoredAction["kind"][]).includes(fact.action.kind),
  );
}

export function isFieldContentRemovalAction(action: AuthoredAction): action is FieldContentRemovalAction {
  return action.kind === "field-value-remove" || action.kind === "materialized-field-clear";
}

function actionBelongsTo<Family extends ActionFamily>(
  action: AuthoredAction,
  family: Family,
): action is ActionInFamily<Family> {
  return (ACTION_KINDS_BY_FAMILY[family] as readonly AuthoredAction["kind"][]).includes(action.kind);
}

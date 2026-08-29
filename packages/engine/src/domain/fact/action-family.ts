import {
  actionBelongsToFamily,
  actionHasAdmission,
  isCatalogGraphAction,
  isCatalogGraphActionKind,
  type ActionFamily,
  type ActionInFamily,
} from "./action-catalog.js";
import type { AuthoredAction, FactAction, GraphAction, ProposableAction } from "./types.js";

export type NodeAction = ActionInFamily<"node">;
export type GraphNodeAction = Extract<GraphAction, NodeAction>;
export type PlacementAction = ActionInFamily<"placement">;
export type SupertagAction = ActionInFamily<"supertag">;
export type TemplateAction = ActionInFamily<"template">;
export type FieldAction = ActionInFamily<"field">;
export type FieldDefinitionAction = ActionInFamily<"fieldDefinition">;
export type FieldConfigurationSetAction = Extract<FieldDefinitionAction, { kind: "field-configuration-set" }>;
export type TextAction = ActionInFamily<"text">;
export type InlineReferenceAction = ActionInFamily<"inlineReference">;
export type SearchExpressionAction = ActionInFamily<"search">;
export type ViewAction = ActionInFamily<"view">;
export type FieldContentRemovalAction = Extract<
  FieldAction,
  { kind: "field-value-remove" | "materialized-field-clear" }
>;

export function isNodeAction<Action extends AuthoredAction>(action: Action): action is Extract<Action, NodeAction> {
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

export function isFieldDefinitionConfigAction(action: AuthoredAction): action is FieldConfigurationSetAction {
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

export function isGraphAction(action: AuthoredAction): action is GraphAction {
  return isCatalogGraphAction(action);
}

export function isGraphActionKind(kind: AuthoredAction["kind"]): kind is GraphAction["kind"] {
  return isCatalogGraphActionKind(kind);
}

export function isProposableAction(action: AuthoredAction): action is ProposableAction {
  return actionHasAdmission(action, "proposable");
}

function actionBelongsTo<Action extends AuthoredAction, Family extends ActionFamily>(
  action: Action,
  family: Family,
): action is Extract<Action, ActionInFamily<Family>> {
  return actionBelongsToFamily(action, family);
}

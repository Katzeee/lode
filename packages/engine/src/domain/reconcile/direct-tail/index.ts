import {
  factActionsFromFacts,
  isFieldAction,
  isFieldDefinitionAction,
  isInlineReferenceAction,
  isNodeAction,
  isPlacementAction,
  isSupertagAction,
  isTemplateAction,
  isTextAction,
  isSearchAction,
  isViewAction,
  type FactAction,
  type Fact,
  type AuthoredAction,
} from "../../fact/index.js";
import type { Projection } from "../projection-types.js";
import { canApplyFieldDirectTail } from "./field-rule.js";
import { canApplyNodeDirectTail } from "./node-rule.js";
import { canApplyPlacementDirectTail } from "./placement-rule.js";
import { canApplySupertagDirectTail } from "./supertag-rule.js";
import { selectNeutralFactTail } from "./tail-selection.js";
import { canApplyTemplateDirectTail } from "./template-rule.js";
import { canApplyTextDirectTail } from "./text-rule.js";
import { canApplyInlineReferenceDirectTail } from "./inline-reference-rule.js";

export function selectEligibleDirectTail(
  projection: Projection,
  facts: readonly Fact[],
  changed: readonly Fact[],
): readonly FactAction[] | null {
  const tail = selectNeutralFactTail(facts, changed);
  if (!tail) {
    return null;
  }
  if (!tail.every((fact) => fact.body.kind === "edit" && fact.body.intent === "direct")) {
    return null;
  }
  const actions = factActionsFromFacts(tail);
  return actions.length > 0 &&
    actions.every((fact) => fact.intent === "direct" && canApplyDirectTail(projection, fact.action))
    ? actions
    : null;
}

function canApplyDirectTail(projection: Projection, authoredAction: AuthoredAction): boolean {
  if (isNodeAction(authoredAction)) {
    return canApplyNodeDirectTail(projection, authoredAction);
  }
  if (isPlacementAction(authoredAction)) {
    return canApplyPlacementDirectTail(projection, authoredAction);
  }
  if (isSupertagAction(authoredAction)) {
    return canApplySupertagDirectTail(projection, authoredAction);
  }
  if (isTemplateAction(authoredAction)) {
    return canApplyTemplateDirectTail(projection, authoredAction);
  }
  if (isFieldAction(authoredAction)) {
    return canApplyFieldDirectTail(projection, authoredAction);
  }
  if (isFieldDefinitionAction(authoredAction)) {
    return false;
  }
  if (isTextAction(authoredAction)) {
    return canApplyTextDirectTail(projection, authoredAction);
  }
  if (isInlineReferenceAction(authoredAction)) {
    return canApplyInlineReferenceDirectTail(projection, authoredAction);
  }
  if (isSearchAction(authoredAction)) {
    return false;
  }
  if (isViewAction(authoredAction)) {
    return false;
  }
  return assertNever(authoredAction);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Direct tail AuthoredAction: ${JSON.stringify(value)}`);
}

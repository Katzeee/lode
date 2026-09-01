import {
  isFieldAction,
  isFieldDefinitionAction,
  isInlineReferenceAction,
  isNodeAction,
  isPlacementAction,
  isSearchAction,
  isSupertagAction,
  isTemplateAction,
  isTextAction,
  isViewAction,
  type GraphAction,
} from "../../../domain/fact/index.js";
import type { InterpretedProjection } from "../../../domain/reconcile/index.js";
import { singleAuthoredActionBatch, type AuthoredActionBatch } from "./action-batch.js";
import { expandPlacementRemoval } from "./deletion-action-expansion.js";
import { expandFieldAction } from "./field-action-expansion.js";
import { expandSupertagAction } from "./supertag-action-expansion.js";
import { expandTemplateAction } from "./template-action-expansion.js";

export function expandGraphAction(action: GraphAction, available: InterpretedProjection): AuthoredActionBatch {
  if (isSupertagAction(action)) {
    return expandSupertagAction(action, available);
  }
  if (isFieldAction(action)) {
    return expandFieldAction(action, available);
  }
  if (isFieldDefinitionAction(action)) {
    return singleAuthoredActionBatch(action);
  }
  if (isTemplateAction(action)) {
    return expandTemplateAction(action, available);
  }
  if (isNodeAction(action)) {
    return singleAuthoredActionBatch(action);
  }
  if (isPlacementAction(action)) {
    return action.kind === "placement-remove"
      ? expandPlacementRemoval(action, available)
      : singleAuthoredActionBatch(action);
  }
  if (isTextAction(action)) {
    return singleAuthoredActionBatch(action);
  }
  if (isInlineReferenceAction(action)) {
    return singleAuthoredActionBatch(action);
  }
  if (isSearchAction(action)) {
    return singleAuthoredActionBatch(action);
  }
  if (isViewAction(action)) {
    return singleAuthoredActionBatch(action);
  }
  return assertNever(action);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled GraphAction expansion: ${JSON.stringify(value)}`);
}

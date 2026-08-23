import { singleAuthoredActionBatch, type AuthoredActionBatch } from "../action-batch.js";
import {
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
  type AuthoredAction,
} from "../../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";
import { expandPlacementRemoval } from "./deletion-rule.js";
import { expandFieldAction } from "./field-rule.js";
import { expandSupertagAction } from "./supertag-rule.js";
import { expandTemplateAction } from "./template-rule.js";

export function expandAction(action: AuthoredAction, available: ScopedProjection): AuthoredActionBatch {
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
  throw new Error(`Unhandled AuthoredAction expansion: ${JSON.stringify(value)}`);
}

import { singleAuthoredActionBatch, type AuthoredActionBatch } from "../action-batch.js";
import type { SupertagAction } from "../../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";

export function expandSupertagAction(action: SupertagAction, _available: ScopedProjection): AuthoredActionBatch {
  switch (action.kind) {
    case "template-member-add":
      return singleAuthoredActionBatch(action);
    case "template-member-remove":
      return singleAuthoredActionBatch(action);
    case "supertag-application-add":
      return singleAuthoredActionBatch(action);
    case "supertag-membership-remove":
      return singleAuthoredActionBatch(action);
    case "supertag-extension-add":
    case "supertag-extension-remove":
    case "template-field-add":
    case "template-field-remove":
    case "template-field-restore":
    case "template-field-visibility-set":
    case "template-field-static-default-set":
    case "optional-field-contribution-add":
    case "optional-field-contribution-remove":
      return singleAuthoredActionBatch(action);
  }
}

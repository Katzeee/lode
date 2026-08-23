import type { AuthoredActionBatch } from "../action-batch.js";
import { fieldDefinitionEndpointOccurrenceId, type FieldAction } from "../../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";
import { createNodeUnlessPresent, createOccurrenceUnlessPresent } from "./generated-lifecycle.js";
import { requireAuthoredActionBatch } from "./action-batch.js";

const END = { after: null, before: null, affinity: "after", fallback: "end" } as const;
const START = { after: null, before: null, affinity: "before", fallback: "start" } as const;

export function expandFieldAction(action: FieldAction, available: ScopedProjection): AuthoredActionBatch {
  switch (action.kind) {
    case "field-materialize":
      return requireAuthoredActionBatch([
        ...createNodeUnlessPresent(
          action.fieldNodeId,
          action.ownerNodeId,
          { placementId: action.fieldOccurrenceId, anchor: END },
          available,
          { intrinsicNodeType: "field" },
        ),
        ...createOccurrenceUnlessPresent(
          fieldDefinitionEndpointOccurrenceId(action.fieldOccurrenceId),
          action.fieldDefinitionId,
          action.fieldNodeId,
          START,
          available,
        ),
        action,
      ]);
    case "field-value-remove":
    case "materialized-field-clear":
      return requireAuthoredActionBatch([action]);
  }
}

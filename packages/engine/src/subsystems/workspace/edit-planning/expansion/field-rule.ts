import type { AuthoredActionBatch } from "../action-batch.js";
import {
  fieldDefinitionEndpointOccurrenceId,
  materializedFieldNodeId,
  materializedFieldOccurrenceId,
  type FieldAction,
} from "../../../../domain/fact/index.js";
import type { ScopedProjection } from "../../../../domain/reconcile/index.js";
import { createNodeUnlessPresent, createOccurrenceUnlessPresent } from "./generated-lifecycle.js";
import { requireAuthoredActionBatch } from "./action-batch.js";

const END = { after: null, before: null, affinity: "after", fallback: "end" } as const;
const START = { after: null, before: null, affinity: "before", fallback: "start" } as const;

export function expandFieldAction(action: FieldAction, available: ScopedProjection): AuthoredActionBatch {
  switch (action.kind) {
    case "field-materialize": {
      const fieldNodeId = materializedFieldNodeId(action.ownerNodeId, action.fieldDefinitionId);
      const fieldOccurrenceId = materializedFieldOccurrenceId(action.ownerNodeId, action.fieldDefinitionId);
      return requireAuthoredActionBatch([
        ...createNodeUnlessPresent(
          fieldNodeId,
          action.ownerNodeId,
          { placementId: fieldOccurrenceId, anchor: END },
          available,
          { intrinsicNodeType: "field" },
        ),
        ...createOccurrenceUnlessPresent(
          fieldDefinitionEndpointOccurrenceId(fieldOccurrenceId),
          action.fieldDefinitionId,
          fieldNodeId,
          START,
          available,
        ),
        action,
      ]);
    }
    case "field-value-remove":
    case "materialized-field-clear":
      return requireAuthoredActionBatch([action]);
  }
}
